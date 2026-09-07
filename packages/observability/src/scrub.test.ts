import assert from 'node:assert/strict';
import { test } from 'node:test';

import { scrubSentryEvent } from './scrub.ts';

/**
 * §2.6's three concrete promises — no tokens, no join codes, no IP
 * addresses — each need their own test, because each is a different kind of
 * mistake: a key name giving away what it holds, a bare value that looks
 * like a code, and an address embedded in prose rather than sitting in its
 * own field.
 */

test('a key named like a secret is redacted regardless of what it holds', () => {
  const event = scrubSentryEvent({
    extra: {
      hostToken: 'eyJhbGciOiJIUzI1NiJ9.abc.def',
      participantToken: 'some-opaque-string',
      sessionSecret: 'do-not-leak-this',
      authorization: 'Bearer xyz',
      cookie: 'session=abc',
      sessionId: 'kept-because-this-is-the-whole-point',
    },
  });

  const extra = event.extra as Record<string, unknown>;
  assert.equal(extra['hostToken'], '[redacted]');
  assert.equal(extra['participantToken'], '[redacted]');
  assert.equal(extra['sessionSecret'], '[redacted]');
  assert.equal(extra['authorization'], '[redacted]');
  assert.equal(extra['cookie'], '[redacted]');
  assert.equal(extra['sessionId'], 'kept-because-this-is-the-whole-point');
});

test('a bare join code value is redacted, spaced or not', () => {
  const event = scrubSentryEvent({
    extra: { code: '482 719', otherCode: '482719', notACode: '4827190' },
  });
  const extra = event.extra as Record<string, unknown>;
  assert.equal(extra['code'], '[redacted]');
  assert.equal(extra['otherCode'], '[redacted]');
  assert.equal(extra['notACode'], '4827190', 'a seven-digit string is not a join code');
});

test('an IPv4 address embedded in a string is redacted, the rest of the string is not', () => {
  const event = scrubSentryEvent({
    extra: { detail: 'connection from 203.0.113.7 failed to negotiate' },
  });
  const detail = (event.extra as Record<string, unknown>)['detail'] as string;
  assert.ok(!detail.includes('203.0.113.7'));
  assert.match(detail, /connection from \[redacted\] failed to negotiate/);
});

test('request headers and cookies are dropped outright, not pattern-matched', () => {
  const event = scrubSentryEvent({
    request: {
      url: '/api/v1/sessions',
      headers: { authorization: 'Bearer xyz', 'user-agent': 'test' },
      cookies: { session: 'abc' },
    },
  });
  const request = event.request as Record<string, unknown>;
  assert.equal(request['headers'], undefined);
  assert.equal(request['cookies'], undefined);
  assert.equal(request['url'], '/api/v1/sessions', 'the rest of the request is kept');
});

test('a user object never carries an IP address', () => {
  const event = scrubSentryEvent({ user: { id: 'participant-1', ip_address: '203.0.113.7' } });
  const user = event.user as Record<string, unknown>;
  assert.equal(user['ip_address'], undefined);
  assert.equal(user['id'], 'participant-1');
});

test('breadcrumb data is scrubbed the same way extra is', () => {
  const event = scrubSentryEvent({
    breadcrumbs: [{ message: 'fetch', data: { hostToken: 'abc', url: '/x' } }],
  });
  const crumbs = event.breadcrumbs as Record<string, unknown>[];
  const data = crumbs[0]?.['data'] as Record<string, unknown>;
  assert.equal(data['hostToken'], '[redacted]');
  assert.equal(data['url'], '/x');
});

test('an IP address in the error message itself is redacted', () => {
  const event = scrubSentryEvent({ message: 'failed to reach 203.0.113.7:3478' });
  assert.ok(!(event.message as string).includes('203.0.113.7'));
});

test('an IP address inside an exception value is redacted', () => {
  const event = scrubSentryEvent({
    exception: { values: [{ type: 'Error', value: 'ECONNREFUSED 203.0.113.7:443' }] },
  });
  const values = (event.exception as { values: { value: string }[] }).values;
  assert.ok(!values[0]?.value.includes('203.0.113.7'));
});

test('nested objects are scrubbed at every depth, not only the top level', () => {
  const event = scrubSentryEvent({
    contexts: { session: { detail: { hostToken: 'nested-secret' } } },
  });
  const contexts = event.contexts as { session: { detail: { hostToken: string } } };
  assert.equal(contexts.session.detail.hostToken, '[redacted]');
});

test('an event with none of these fields passes through unchanged', () => {
  const event = scrubSentryEvent({ level: 'error', timestamp: 12345 });
  assert.deepEqual(event, { level: 'error', timestamp: 12345 });
});
