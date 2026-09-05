import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION } from './constants.ts';
import { ERROR_CODES, USER_MESSAGES } from './errors.ts';
import { envelope, errorMessage, parseClientEnvelope } from './parse.ts';

test('a well-formed client envelope round-trips', () => {
  const frame = JSON.stringify(envelope({ type: 'session.viewer.request', joinCode: '482719' }));
  const result = parseClientEnvelope(frame);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.payload.type, 'session.viewer.request');
    assert.equal(result.value.v, PROTOCOL_VERSION);
  }
});

test('the envelope carries exactly v, id, ts and payload', () => {
  // The message type lives in the payload, not beside it. Pinned because the
  // file's own description of the envelope claimed a `type` field here that
  // the server neither sends nor accepts, and prose is what someone writing a
  // client by hand reads first.
  const built = envelope({ type: 'ping' });
  assert.deepEqual(Object.keys(built).sort(), ['id', 'payload', 'ts', 'v']);
  assert.equal('type' in built, false);
});

test('a reply reuses the id it is answering, and an error points with inReplyTo', () => {
  const asked = envelope({ type: 'ping' });
  const answered = envelope({ type: 'pong' }, asked.id);
  assert.equal(answered.id, asked.id, 'a direct reply pairs by envelope id');

  const failed = errorMessage('MALFORMED_MESSAGE', asked.id);
  assert.equal(failed.type === 'error' && failed.inReplyTo, asked.id);

  // An error can arrive with nothing behind it, so the field is absent rather
  // than empty when there is nothing to point at.
  const unprompted = errorMessage('INTERNAL_ERROR');
  assert.equal('inReplyTo' in unprompted, false);
});

test('a version mismatch is reported as an out-of-date client, not a parse error', () => {
  const frame = JSON.stringify({
    v: 99,
    id: 'a',
    ts: Date.now(),
    payload: { type: 'ping' },
  });
  const result = parseClientEnvelope(frame);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'UNSUPPORTED_PROTOCOL_VERSION');
});

test('oversized frames are rejected before JSON parsing', () => {
  const result = parseClientEnvelope('x'.repeat(MAX_MESSAGE_BYTES + 1));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'MESSAGE_TOO_LARGE');
});

test('malformed JSON is rejected', () => {
  const result = parseClientEnvelope('{not json');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'MALFORMED_MESSAGE');
});

test('an unknown message type is rejected', () => {
  const frame = JSON.stringify({
    v: PROTOCOL_VERSION,
    id: 'a',
    ts: Date.now(),
    payload: { type: 'session.viewer.grantAccessPlease' },
  });
  const result = parseClientEnvelope(frame);
  assert.equal(result.ok, false);
});

test('a join code that is not exactly six digits is rejected', () => {
  for (const joinCode of ['48271', '4827199', '48271a', '']) {
    const frame = JSON.stringify(envelope({ type: 'session.viewer.request', joinCode }));
    assert.equal(parseClientEnvelope(frame).ok, false, `accepted ${joinCode}`);
  }
});

test('every error code has user-facing text that avoids jargon', () => {
  const jargon = /\b(ICE|SDP|DTLS|SRTP|WebRTC|TURN|STUN|socket|null|undefined)\b/i;
  for (const code of ERROR_CODES) {
    const message = USER_MESSAGES[code];
    assert.ok(message, `${code} has no user message`);
    assert.ok(message.length > 10, `${code} message is too terse`);
    assert.ok(!jargon.test(message), `${code} leaks jargon: "${message}"`);
  }
});

test('error frames carry code, text and retry policy together', () => {
  const failed = errorMessage('CONNECTION_FAILED', 'req-1');
  assert.equal(failed.type, 'error');
  if (failed.type === 'error') {
    assert.equal(failed.retryable, false);
    assert.equal(failed.inReplyTo, 'req-1');
    assert.ok(failed.userMessage.length > 0);
  }

  const lost = errorMessage('CONNECTION_LOST');
  if (lost.type === 'error') assert.equal(lost.retryable, true);
});

test('a join request must carry either a code or a token', () => {
  const frame = JSON.stringify(envelope({ type: 'session.viewer.request' }));
  assert.equal(parseClientEnvelope(frame).ok, false);
});

test('a share-link token must be 22 base64url characters', () => {
  const good = 'A'.repeat(22);
  assert.equal(
    parseClientEnvelope(
      JSON.stringify(envelope({ type: 'session.viewer.request', joinToken: good })),
    ).ok,
    true,
  );

  for (const joinToken of ['A'.repeat(21), 'A'.repeat(23), `${'A'.repeat(21)}+`]) {
    assert.equal(
      parseClientEnvelope(JSON.stringify(envelope({ type: 'session.viewer.request', joinToken })))
        .ok,
      false,
      `accepted ${joinToken}`,
    );
  }
});

test('SDP is relayed as an opaque string and never inspected', () => {
  const frame = JSON.stringify(
    envelope({
      type: 'rtc.offer',
      to: '00000000-0000-4000-8000-000000000000',
      sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n',
    }),
  );
  const result = parseClientEnvelope(frame);
  assert.equal(result.ok, true);
});

test('parsing works with no Node globals — browsers have no Buffer', () => {
  // The walking skeleton caught this the hard way: the first version used
  // Buffer for the size check and for decoding, so every browser client threw
  // ReferenceError inside its WebSocket message handler and silently dropped
  // every frame. The connection looked fine and nothing ever arrived.
  const savedBuffer = (globalThis as { Buffer?: unknown }).Buffer;
  delete (globalThis as { Buffer?: unknown }).Buffer;

  try {
    const frame = JSON.stringify(envelope({ type: 'ping' }));
    assert.equal(parseClientEnvelope(frame).ok, true);

    // Binary frames take the TextDecoder path.
    const bytes = new TextEncoder().encode(frame);
    assert.equal(parseClientEnvelope(bytes).ok, true);
  } finally {
    (globalThis as { Buffer?: unknown }).Buffer = savedBuffer;
  }
});

test('multi-byte characters are measured in bytes, not code units', () => {
  // A four-byte emoji is two UTF-16 code units, so a naive `.length` check
  // would under-count and let an oversized frame through.
  const emoji = '😀';
  assert.equal(emoji.length, 2);
  assert.equal(new TextEncoder().encode(emoji).length, 4);

  const oversized = JSON.stringify({
    v: 1,
    id: 'a',
    ts: Date.now(),
    payload: {
      type: 'rtc.offer',
      to: '00000000-0000-4000-8000-000000000000',
      sdp: emoji.repeat(20000),
    },
  });
  const result = parseClientEnvelope(oversized);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'MESSAGE_TOO_LARGE');
});
