import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createSessionIdentifiers,
  extractJoinToken,
  formatJoinCode,
  generateJoinCode,
  generateJoinToken,
  isValidJoinCode,
  isValidJoinToken,
  normaliseJoinCode,
} from './identifiers.ts';

test('a join code is always exactly six digits', () => {
  for (let i = 0; i < 500; i += 1) {
    const code = generateJoinCode();
    assert.match(code, /^\d{6}$/, `bad code: ${code}`);
    assert.ok(isValidJoinCode(code));
  }
});

test('join code digits are not visibly skewed', () => {
  // Rejection sampling exists so that `% 10` does not favour 0-5. This will not
  // catch a subtle bias, but it does catch the obvious one that appears if the
  // rejection step is ever removed as "unnecessary".
  const counts = new Array(10).fill(0);
  for (let i = 0; i < 2000; i += 1) {
    for (const ch of generateJoinCode()) counts[Number(ch)] += 1;
  }
  const expected = (2000 * 6) / 10;
  for (const [digit, count] of counts.entries()) {
    const drift = Math.abs(count - expected) / expected;
    assert.ok(drift < 0.25, `digit ${digit} appeared ${count} times, expected ~${expected}`);
  }
});

test('join codes do not repeat over a large sample', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i += 1) seen.add(generateJoinCode());
  // A million possibilities, so a couple of collisions in 2000 would be
  // ordinary. Far fewer than half being unique would mean it is not random.
  assert.ok(seen.size > 1950, `only ${seen.size} unique codes in 2000`);
});

test('a join token is 22 base64url characters and never repeats', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i += 1) {
    const token = generateJoinToken();
    assert.match(token, /^[A-Za-z0-9_-]{22}$/, `bad token: ${token}`);
    assert.ok(isValidJoinToken(token));
    seen.add(token);
  }
  assert.equal(seen.size, 2000, '128 bits must not collide in 2000 draws');
});

test('tokens carry no padding and no URL-unsafe characters', () => {
  for (let i = 0; i < 200; i += 1) {
    const token = generateJoinToken();
    assert.ok(!token.includes('='), 'padding would be escaped in a URL');
    assert.ok(!token.includes('+') && !token.includes('/'), 'must be base64url');
  }
});

test('a code is displayed grouped but stored plain', () => {
  assert.equal(formatJoinCode('482719'), '482 719');
  assert.equal(normaliseJoinCode('482 719'), '482719');
  assert.equal(normaliseJoinCode('482-719'), '482719');
  assert.equal(normaliseJoinCode('  482 719  '), '482719');
});

test('a token is recovered from whatever the user pastes', () => {
  const token = generateJoinToken();
  assert.equal(extractJoinToken(token), token);
  assert.equal(extractJoinToken(`  ${token}  `), token);
  assert.equal(extractJoinToken(`https://crossscreen.app/j/${token}`), token);
  assert.equal(extractJoinToken(`https://crossscreen.app/j/${token}?utm=x`), token);
});

test('nonsense is refused rather than half-accepted', () => {
  assert.equal(extractJoinToken('482719'), null);
  assert.equal(extractJoinToken('https://crossscreen.app/'), null);
  assert.equal(extractJoinToken('not a url at all'), null);
  assert.equal(extractJoinToken(''), null);
});

test('a new session gets distinct identifiers and a bounded lifetime', () => {
  const now = 1_700_000_000_000;
  const a = createSessionIdentifiers(now);
  const b = createSessionIdentifiers(now);

  assert.notEqual(a.sessionId, b.sessionId);
  assert.notEqual(a.joinToken, b.joinToken);
  assert.match(a.sessionId, /^[0-9a-f-]{36}$/);
  assert.equal(a.createdAt, now);
  assert.ok(a.expiresAt > now, 'a session must expire');
  assert.equal(a.expiresAt - a.createdAt, 12 * 60 * 60 * 1000);
});
