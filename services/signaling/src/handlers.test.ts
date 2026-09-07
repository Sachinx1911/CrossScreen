import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ClientMessage, ConnectionState } from '@crossscreen/protocol';

// config.ts reads SESSION_SECRET at module load and exits the process if it
// is missing, so it must be set before handlers.ts (which imports config.ts)
// is loaded — the same reason session-flow.test.ts imports server.ts
// dynamically rather than statically.
process.env['SESSION_SECRET'] ??= 'a-test-secret-long-enough-for-config-ts';

const { handleMessage } = await import('./handlers.ts');
const { InMemorySessionStore } = await import('./session-store.ts');
type Connection = import('./handlers.ts').Connection;

/**
 * `stats.report` never answers over the wire — nothing is sent back — so the
 * wire-level tests in session-flow.test.ts cannot see whether it actually
 * reached the recorder, which is the entire point of phase-2-reliability.md
 * §2.4. Unit-testing the handler directly against a fake recorder is the
 * server-side equivalent of what those tests do for the protocol: this is
 * trusted code, not a client an attacker replaces, so there is nothing wrong
 * with asserting on it directly.
 */

const fakeSocket = () => ({ readyState: 1, OPEN: 1, send: () => undefined }) as never;

function fakeConnection(overrides: Partial<Connection> = {}): {
  connection: Connection;
  stats: unknown[];
  events: unknown[];
} {
  const stats: unknown[] = [];
  const events: unknown[] = [];
  const connection: Connection = {
    socket: fakeSocket(),
    userAgent: undefined,
    ipHash: undefined,
    sessionId: crypto.randomUUID(),
    participantId: crypto.randomUUID(),
    recorder: {
      sessionEvent: (e) => events.push(e),
      connectionStat: (s) => stats.push(s),
      abuseEvent: () => undefined,
      close: () => Promise.resolve(),
    },
    ...overrides,
  };
  return { connection, stats, events };
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
