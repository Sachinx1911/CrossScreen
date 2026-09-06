import assert from 'node:assert/strict';
import { before, test } from 'node:test';

import { verifyHostToken } from '@crossscreen/protocol';

const SECRET = 'a-test-secret-long-enough-to-be-accepted';

let buildApp: typeof import('./app.ts').buildApp;

before(async () => {
  // Config is read at import time, so it has to be set before the first import.
  process.env['SESSION_SECRET'] = SECRET;
  process.env['LOG_LEVEL'] = 'error';
  process.env['APP_ORIGIN'] = 'https://crossscreen.test';
  ({ buildApp } = await import('./app.ts'));
});

/** Collects what would have been recorded, without a database. */
function spyRecorder() {
  const events: unknown[] = [];
  return {
    events,
    recorder: {
      sessionEvent: (event: unknown) => events.push(event),
      connectionStat: () => undefined,
      abuseEvent: () => undefined,
      close: () => Promise.resolve(),
    },
  };
}

async function createSession() {
  const app = buildApp(spyRecorder().recorder as never);
  const response = await app.inject({ method: 'POST', url: '/api/v1/sessions' });
  await app.close();
  return { response, body: response.json() as Record<string, unknown> };
}

test('creating a session returns a usable code, link and token', async () => {
  const { response, body } = await createSession();

  assert.equal(response.statusCode, 201);
  assert.match(body['joinCode'] as string, /^\d{6}$/);
  assert.equal(
    body['joinCodeDisplay'],
    `${(body['joinCode'] as string).slice(0, 3)} ${(body['joinCode'] as string).slice(3)}`,
  );
  assert.match(body['joinToken'] as string, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(body['shareLink'], `https://crossscreen.test/j/${body['joinToken'] as string}`);
  assert.ok((body['expiresAt'] as number) > Date.now());
});

test('the host token verifies and names the session it was issued for', async () => {
  const { body } = await createSession();
  const result = await verifyHostToken(body['hostToken'] as string, SECRET);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.claims.code, body['joinCode']);
  assert.equal(result.claims.tok, body['joinToken']);
  assert.match(result.claims.sid, /^[0-9a-f-]{36}$/);
});

test('the internal session id never leaves the service', async () => {
  // It lives inside the signed token, where only signaling reads it. Putting
  // it in the response body would expose an identifier architecture §7 keeps
  // deliberately private — and it is now generated where the handler can see
  // it, which is exactly when that becomes easy to get wrong.
  const { response, body } = await createSession();
  assert.equal(body['sessionId'], undefined);

  const result = await verifyHostToken(body['hostToken'] as string, SECRET);
  if (!result.ok) assert.fail('token should verify');
  assert.ok(!response.body.includes(result.claims.sid), 'session id leaked into the response');
});

test('creation is recorded against the internal id, without the join code', async () => {
  const spy = spyRecorder();
  const app = buildApp(spy.recorder as never);
  const response = await app.inject({ method: 'POST', url: '/api/v1/sessions' });
  await app.close();

  const body = response.json() as Record<string, unknown>;
  assert.equal(spy.events.length, 1);

  const event = spy.events[0] as Record<string, unknown>;
  assert.equal(event['event'], 'created');
  assert.match(String(event['sessionId']), /^[0-9a-f-]{36}$/);

  // A durable table of join codes would outlive the sessions they belong to
  // for no purpose, and tokens have no business in a database at all.
  const serialised = JSON.stringify(event);
  assert.ok(!serialised.includes(body['joinCode'] as string), 'the join code was recorded');
  assert.ok(!serialised.includes(body['joinToken'] as string), 'the link token was recorded');
  assert.ok(!serialised.includes(body['hostToken'] as string), 'the host token was recorded');
});

test('two sessions never share identifiers', async () => {
  const a = await createSession();
  const b = await createSession();

  assert.notEqual(a.body['joinCode'], b.body['joinCode']);
  assert.notEqual(a.body['joinToken'], b.body['joinToken']);
  assert.notEqual(a.body['hostToken'], b.body['hostToken']);
});

test('ICE servers are served for clients to read rather than hardcode', async () => {
  const app = buildApp();
  const response = await app.inject({ method: 'GET', url: '/api/v1/ice-servers' });
  await app.close();

  assert.equal(response.statusCode, 200);
  const body = response.json() as { iceServers: { urls: string[] }[] };
  assert.ok(body.iceServers.length > 0);
  assert.ok(body.iceServers[0]?.urls.some((u) => u.startsWith('stun:')));
});

test('an unknown path answers 404 rather than a stack trace', async () => {
  const app = buildApp();
  const response = await app.inject({ method: 'GET', url: '/api/v1/nope' });
  await app.close();

  assert.equal(response.statusCode, 404);
  assert.equal((response.json() as { error: string }).error, 'not_found');
});

test('health check reports liveness', async () => {
  const app = buildApp();
  const response = await app.inject({ method: 'GET', url: '/healthz' });
  await app.close();

  assert.equal(response.statusCode, 200);
  assert.equal((response.json() as { ok: boolean }).ok, true);
});

test('the desktop renderer origin is allowed through CORS', async () => {
  // Its renderer is served from app://bundle, so every call it makes is
  // cross-origin. Without this the desktop app cannot create a session at all,
  // and the browser reports it as a network failure with no further detail.
  const app = buildApp(spyRecorder().recorder as never);
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/sessions',
    headers: { origin: 'app://bundle' },
  });
  await app.close();

  assert.equal(response.statusCode, 201);
  assert.equal(response.headers['access-control-allow-origin'], 'app://bundle');
});

test('an unrelated origin is not allowed', async () => {
  // An allow-list rather than `*`, because these endpoints carry rate limits
  // keyed to the caller in Phase 3a.
  const app = buildApp(spyRecorder().recorder as never);
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/sessions',
    headers: { origin: 'https://not-crossscreen.example' },
  });
  await app.close();

  assert.equal(response.headers['access-control-allow-origin'], undefined);
});
