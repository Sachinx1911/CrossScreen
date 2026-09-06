import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSessionIdentifiers } from './identifiers.ts';
import { signHostToken, verifyHostToken, type HostTokenClaims } from './host-token.ts';

const SECRET = 'test-secret-not-used-anywhere-real';
const OTHER_SECRET = 'a-different-secret';

function claimsFor(now = Date.now()): HostTokenClaims {
  const ids = createSessionIdentifiers(now);
  return {
    sid: ids.sessionId,
    code: ids.joinCode,
    tok: ids.joinToken,
    iat: Math.floor(now / 1000),
    exp: Math.floor(ids.expiresAt / 1000),
  };
}

test('a signed token verifies and returns its claims intact', async () => {
  const claims = claimsFor();
  const result = await verifyHostToken(await signHostToken(claims, SECRET), SECRET);

  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.claims, claims);
});

test('a token signed with another secret is refused', async () => {
  const token = await signHostToken(claimsFor(), OTHER_SECRET);
  const result = await verifyHostToken(token, SECRET);

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'bad_signature');
});

test('editing the claims invalidates the signature', async () => {
  // The attack this is really about: a host token names one session, and
  // rewriting `sid` would name someone else's.
  const token = await signHostToken(claimsFor(), SECRET);
  const [header, payload, signature] = token.split('.') as [string, string, string];

  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as HostTokenClaims;
  decoded.sid = '00000000-0000-4000-8000-000000000000';
  const forged = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url');

  const result = await verifyHostToken(`${header}.${forged}.${signature}`, SECRET);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'bad_signature');
});

test('an expired token is refused', async () => {
  const past = Date.now() - 24 * 60 * 60 * 1000;
  const claims = claimsFor(past);
  const token = await signHostToken(claims, SECRET);

  const result = await verifyHostToken(token, SECRET, past + 13 * 60 * 60 * 1000);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'expired');
});

test('expiry is judged in seconds, not milliseconds', async () => {
  // A token whose exp is treated as milliseconds looks expired half a century
  // early, which would have every session refused the moment it was created.
  const now = Date.now();
  const result = await verifyHostToken(await signHostToken(claimsFor(now), SECRET), SECRET, now);
  assert.equal(result.ok, true);
});

test('a signature is checked before the claims are read', async () => {
  // An unsigned token must fail identically whatever it claims, so that
  // probing tells an attacker nothing about which sessions exist.
  const nonsense = Buffer.from(JSON.stringify({ sid: 'not-a-uuid' }), 'utf8').toString('base64url');
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

  const result = await verifyHostToken(`${header}.${nonsense}.bm90LWEtc2ln`, SECRET);
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.equal(result.reason, 'bad_signature', 'must not reveal that claims are invalid');
});

test('malformed input is refused rather than throwing', async () => {
  for (const bad of ['', 'a', 'a.b', 'a.b.c.d', 'not.base64!.here', '...']) {
    const result = await verifyHostToken(bad, SECRET);
    assert.equal(result.ok, false, `accepted ${bad}`);
  }
});

test('claims that pass the signature but not the schema are refused', async () => {
  // Signed with our own secret, so the signature is genuine — the join code is
  // not six digits. A valid signature must not be enough on its own.
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const bad = { sid: crypto.randomUUID(), code: '12345', tok: 'x', iat: 0, exp: 9_999_999_999 };
  const body = `${header}.${Buffer.from(JSON.stringify(bad)).toString('base64url')}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const token = `${body}.${Buffer.from(new Uint8Array(sig)).toString('base64url')}`;

  const result = await verifyHostToken(token, SECRET);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'bad_claims');
});
