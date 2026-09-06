import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hashIp } from './hash-ip.ts';
import { NoopRecorder } from './noop-recorder.ts';
import { createRecorder } from './index.ts';

/**
 * Two properties matter here, and neither is about SQL.
 *
 * That an address is countable but not recoverable, and that recording can
 * never break the thing it observes. A session that fails because a database
 * was slow is a far worse outcome than a session nobody has a record of.
 */

function fakeLog() {
  const lines: { event: string; fields?: Record<string, unknown> }[] = [];
  const record =
    (event: string) =>
    (name: string, fields?: Record<string, unknown>): void => {
      lines.push({ event: `${event}:${name}`, ...(fields === undefined ? {} : { fields }) });
    };
  return {
    lines,
    logger: {
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
    },
  };
}

const SECRET = 'a-test-secret-for-hashing-addresses';

test('the same address always hashes the same, and different ones differ', () => {
  assert.equal(hashIp('203.0.113.7', SECRET), hashIp('203.0.113.7', SECRET));
  assert.notEqual(hashIp('203.0.113.7', SECRET), hashIp('203.0.113.8', SECRET));
});

test('the address cannot be read back out of the hash', () => {
  const ip = '203.0.113.7';
  const hashed = hashIp(ip, SECRET);
  assert.ok(hashed);
  assert.ok(!hashed.includes(ip));
  assert.ok(!hashed.includes('203'));
  assert.ok(!hashed.includes('113'));
});

test('a different key gives a different hash for the same address', () => {
  // Keyed rather than plain: every IPv4 address can be hashed in minutes, so
  // an unkeyed digest would be decorative rather than protective.
  assert.notEqual(hashIp('203.0.113.7', SECRET), hashIp('203.0.113.7', 'another-secret-entirely'));
});

test('hashes are short, fixed-length and URL-safe', () => {
  for (const ip of ['203.0.113.7', '2001:db8::1', '10.0.0.1']) {
    const hashed = hashIp(ip, SECRET);
    assert.ok(hashed);
    assert.equal(hashed.length, 22);
    assert.match(hashed, /^[A-Za-z0-9_-]+$/);
  }
});

test('a missing address hashes to nothing rather than to a constant', () => {
  // A constant would put every anonymous request in one bucket and make rate
  // limiting count them together.
  assert.equal(hashIp(undefined, SECRET), undefined);
  assert.equal(hashIp('', SECRET), undefined);
});

test('no database means a working service and one loud warning', () => {
  const { lines, logger } = fakeLog();
  const recorder = createRecorder(undefined, logger);

  assert.ok(recorder instanceof NoopRecorder);
  const warning = lines.find((l) => l.event === 'warn:db.not_configured');
  assert.ok(warning, 'silence would let a deployment lose everything without a word');
  assert.match(String(warning.fields?.['hint']), /DATABASE_URL/);
});

test('a blank database URL is treated as absent, not as a bad URL', () => {
  const { logger } = fakeLog();
  assert.ok(createRecorder('   ', logger) instanceof NoopRecorder);
});

test('the no-op accepts everything without throwing', async () => {
  // Recording must never be able to break the thing it observes.
  const { logger } = fakeLog();
  const recorder = createRecorder(undefined, logger);

  assert.doesNotThrow(() => {
    recorder.sessionEvent({ sessionId: crypto.randomUUID(), event: 'created' });
    recorder.connectionStat({ sessionId: crypto.randomUUID(), transport: 'relay' });
    recorder.abuseEvent({ event: 'code_attempt_failed' });
  });
  await recorder.close();
});

test('it warns once at startup, not once per event', () => {
  const { lines, logger } = fakeLog();
  const recorder = createRecorder(undefined, logger);

  for (let i = 0; i < 50; i += 1) {
    recorder.sessionEvent({ sessionId: crypto.randomUUID(), event: 'created' });
  }

  const warnings = lines.filter((l) => l.event === 'warn:db.not_configured');
  assert.equal(warnings.length, 1, 'a line per event would bury the warning it is giving');
});
