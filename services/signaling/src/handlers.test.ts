import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ClientMessage, ConnectionState, HostTokenClaims } from '@crossscreen/protocol';

// config.ts reads SESSION_SECRET at module load and exits the process if it
// is missing, so it must be set before handlers.ts (which imports config.ts)
// is loaded — the same reason session-flow.test.ts imports server.ts
// dynamically rather than statically.
process.env['SESSION_SECRET'] ??= 'a-test-secret-long-enough-for-config-ts';

const { handleMessage } = await import('./handlers.ts');
const { InMemorySessionStore } = await import('./session-store.ts');
const { LiveSession } = await import('./live-session.ts');
const { RateLimiter } = await import('@crossscreen/rate-limit');
type Connection = import('./handlers.ts').Connection;

/**
 * `stats.report` never answers over the wire — nothing is sent back — so the
 * wire-level tests in session-flow.test.ts cannot see whether it actually
 * reached the recorder, which is the entire point of phase-2-reliability.md
 * §2.4. Unit-testing the handler directly against a fake recorder is the
 * server-side equivalent of what those tests do for the protocol: this is
 * trusted code, not a client an attacker replaces, so there is nothing wrong
 * with asserting on it directly.
 *
 * The rate-limiting and session-lock tests below (§3.1) need the same thing
 * for a different reason: a shared wire-level server would carry one
 * `RateLimiter` across every test in the file, so an earlier test's join
 * attempts would count against a later test's — exactly the cross-test
 * pollution a fresh limiter per test avoids.
 */

function fakeSocket(sent: unknown[] = []) {
  return {
    readyState: 1,
    OPEN: 1,
    send: (data: string) => {
      sent.push(JSON.parse(data));
    },
  } as never;
}

/** A limiter wide enough that nothing in this file trips it by accident, unless the test says otherwise. */
function permissiveLimiter() {
  return new RateLimiter([{ windowMs: 60_000, max: 1_000 }]);
}

function fakeConnection(overrides: Partial<Connection> = {}): {
  connection: Connection;
  stats: unknown[];
  events: unknown[];
  abuse: unknown[];
  sent: unknown[];
} {
  const stats: unknown[] = [];
  const events: unknown[] = [];
  const abuse: unknown[] = [];
  const sent: unknown[] = [];
  const connection: Connection = {
    socket: fakeSocket(sent),
    joinAttemptLimiter: permissiveLimiter(),
    userAgent: undefined,
    ipHash: undefined,
    sessionId: crypto.randomUUID(),
    participantId: crypto.randomUUID(),
    recorder: {
      sessionEvent: (e) => events.push(e),
      connectionStat: (s) => stats.push(s),
      abuseEvent: (e) => abuse.push(e),
      close: () => Promise.resolve(),
    },
    ...overrides,
  };
  return { connection, stats, events, abuse, sent };
}

function claims(now = Date.now()): HostTokenClaims {
  return {
    sid: crypto.randomUUID(),
    code: '482719',
    tok: 'A'.repeat(22),
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + 43_200,
  };
}

function viewerRequest(
  fields: Partial<ClientMessage & { type: 'session.viewer.request' }> = {},
): ClientMessage {
  return { type: 'session.viewer.request', joinCode: '482719', ...fields } as ClientMessage;
}

function payloadOf(sent: unknown[], index = 0): { type: string; code?: string } {
  return (sent[index] as { payload: { type: string; code?: string } }).payload;
}

function statsReport(
  fields: Partial<ClientMessage & { type: 'stats.report' }> = {},
): ClientMessage {
  return {
    type: 'stats.report',
    quality: 'good',
    connectionState: 'connected' as ConnectionState,
    transport: 'direct',
    ...fields,
  } as ClientMessage;
}

test('a stats report carries packet loss and bitrate through to the recorder', async () => {
  const { connection, stats } = fakeConnection();
  await handleMessage(
    connection,
    statsReport({ roundTripMs: 42, packetLossPct: 2.5, bitrateKbps: 1800 }),
    'id-1',
    new InMemorySessionStore(),
  );

  assert.equal(stats.length, 1);
  assert.deepEqual(stats[0], {
    sessionId: connection.sessionId,
    participantId: connection.participantId,
    transport: 'direct',
    quality: 'good',
    roundTripMs: 42,
    packetLossPct: 2.5,
    bitrateKbps: 1800,
    connectionState: 'connected',
  });
});

test('a failed connectionState is recorded, not silently dropped', async () => {
  const { connection, stats } = fakeConnection();
  await handleMessage(
    connection,
    statsReport({ connectionState: 'failed' as ConnectionState, transport: 'unknown' }),
    'id-1',
    new InMemorySessionStore(),
  );

  assert.equal(stats[0] && (stats[0] as { connectionState: string }).connectionState, 'failed');
});

test('reaching connected records a one-time session event, for time-to-connect', async () => {
  const { connection, events } = fakeConnection();
  const store = new InMemorySessionStore();

  await handleMessage(connection, statsReport(), 'id-1', store);
  await handleMessage(connection, statsReport(), 'id-2', store);
  await handleMessage(connection, statsReport(), 'id-3', store);

  const connectedEvents = events.filter((e) => (e as { event: string }).event === 'connected');
  assert.equal(
    connectedEvents.length,
    1,
    'a report arrives every couple of seconds for the life of the connection — only the first one marks "connected"',
  );
  assert.deepEqual(connectedEvents[0], {
    sessionId: connection.sessionId,
    event: 'connected',
    participantId: connection.participantId,
  });
});

test('a report before the peer connects records no connected event', async () => {
  const { connection, events } = fakeConnection();
  await handleMessage(
    connection,
    statsReport({ connectionState: 'checking' as ConnectionState }),
    'id-1',
    new InMemorySessionStore(),
  );

  assert.equal(events.length, 0);
});

test('a report with no session attached is not recorded at all', async () => {
  const { connection, stats, events } = fakeConnection({ sessionId: undefined });
  await handleMessage(connection, statsReport(), 'id-1', new InMemorySessionStore());

  assert.equal(stats.length, 0);
  assert.equal(events.length, 0);
});

/**
 * Rate limiting and the per-session lock (phase-3a-production.md §3.1,
 * ADR-0006). Checked before the code/link lookup even runs, so what is
 * tested here is the enumeration defence itself, not merely that a counter
 * increments somewhere.
 */

test('the sixth join attempt from one address in a minute is rate limited', async () => {
  const limiter = new RateLimiter([{ windowMs: 60_000, max: 5 }]);
  const { connection, sent } = fakeConnection({ ipHash: 'ip-1', joinAttemptLimiter: limiter });
  const store = new InMemorySessionStore();

  for (let i = 0; i < 5; i += 1) {
    await handleMessage(connection, viewerRequest(), `id-${i}`, store);
    assert.equal(
      payloadOf(sent, i).code,
      'SESSION_NOT_FOUND',
      `attempt ${i + 1} should still be allowed through`,
    );
  }

  await handleMessage(connection, viewerRequest(), 'id-6', store);
  assert.equal(payloadOf(sent, 5).code, 'RATE_LIMITED');
});

test('a connection with no address hash is never rate limited', async () => {
  // The safer default for the rare case of a socket with no remote address
  // at all — see the comment in handlers.ts's viewerRequest.
  const limiter = new RateLimiter([{ windowMs: 60_000, max: 1 }]);
  const { connection, sent } = fakeConnection({ ipHash: undefined, joinAttemptLimiter: limiter });
  const store = new InMemorySessionStore();

  for (let i = 0; i < 5; i += 1) {
    await handleMessage(connection, viewerRequest(), `id-${i}`, store);
  }
  for (const envelope of sent) {
    assert.equal(payloadOf([envelope]).code, 'SESSION_NOT_FOUND');
  }
});

test('a locked session refuses a fresh join attempt, by code or by link', async () => {
  const session = new LiveSession(claims(), fakeSocket());
  session.locked = true;
  const store = new InMemorySessionStore();
  store.add(session);

  const { connection, sent } = fakeConnection();
  await handleMessage(connection, viewerRequest({ joinCode: session.joinCode }), 'id-1', store);

  assert.equal(payloadOf(sent).code, 'SESSION_LOCKED');
});

test('a locked session still lets an already-approved viewer resume', async () => {
  const session = new LiveSession(claims(), fakeSocket());
  const store = new InMemorySessionStore();
  store.add(session);

  const viewer = session.addViewer({
    deviceLabel: 'Windows · Edge',
    approximateLocation: undefined,
    joinedVia: 'code',
    socket: fakeSocket(),
  });
  session.approve(viewer.id);
  session.locked = true;

  const { connection, sent } = fakeConnection();
  await handleMessage(
    connection,
    viewerRequest({
      joinCode: session.joinCode,
      resume: { participantId: viewer.id, participantToken: viewer.token ?? '' },
    }),
    'id-1',
    store,
  );

  assert.equal(sent.length, 1);
  assert.equal(
    payloadOf(sent).type,
    'session.state',
    'a resume succeeds — no error, no SESSION_LOCKED',
  );
});
