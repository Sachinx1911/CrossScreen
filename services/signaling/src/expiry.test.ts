import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SESSION_TIMEOUTS, type HostTokenClaims } from '@crossscreen/protocol';

import { LiveSession } from './live-session.ts';
import { InMemorySessionStore, startSweeper } from './session-store.ts';

/**
 * Sessions have to end on a timer, not only when someone disconnects.
 *
 * The cases that matter produce no event to react to: a host whose laptop
 * slept, a session nobody ever joined, a viewer whose phone lost signal
 * without closing the socket. Without the sweeper those sit in memory
 * forever, and their join codes stay live — which is a security question, not
 * a housekeeping one.
 */

const fakeSocket = () => ({ readyState: 1, OPEN: 1, send: () => undefined }) as never;

function claims(now: number): HostTokenClaims {
  return {
    sid: crypto.randomUUID(),
    code: '482719',
    tok: 'A'.repeat(22),
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + 43_200,
  };
}

test('a session with nobody in it is swept once it goes idle', () => {
  const now = Date.now();
  const store = new InMemorySessionStore();
  store.add(new LiveSession(claims(now), fakeSocket(), now));

  assert.deepEqual(store.sweep(now + SESSION_TIMEOUTS.idleMs - 1_000), []);
  assert.equal(store.size, 1, 'not yet');

  const swept = store.sweep(now + SESSION_TIMEOUTS.idleMs + 1_000);
  assert.equal(swept.length, 1);
  assert.equal(store.size, 0);
});

test('a swept session takes its join code and link with it', () => {
  // The important half. A code that outlives its session is a code someone
  // could still present, and the whole safety argument for a six-digit code
  // rests on it being short-lived (ADR-0006).
  const now = Date.now();
  const store = new InMemorySessionStore();
  const session = new LiveSession(claims(now), fakeSocket(), now);
  store.add(session);

  assert.ok(store.byCode(session.joinCode));
  assert.ok(store.byToken(session.joinToken));

  store.sweep(now + SESSION_TIMEOUTS.idleMs + 1_000);

  assert.equal(store.byCode(session.joinCode), undefined, 'the code is still resolvable');
  assert.equal(store.byToken(session.joinToken), undefined, 'the link still works');
  assert.equal(store.byId(session.sessionId), undefined);
});

test('an occupied session is left alone, however long it runs', () => {
  const now = Date.now();
  const store = new InMemorySessionStore();
  const session = new LiveSession(claims(now), fakeSocket(), now);
  session.addViewer({
    deviceLabel: 'Windows · Chrome',
    approximateLocation: undefined,
    joinedVia: 'code',
    socket: fakeSocket(),
    now,
  });
  store.add(session);

  assert.deepEqual(store.sweep(now + 60 * 60 * 1_000), [], 'someone is watching');
});

test('the hard ceiling applies even to a busy session', () => {
  const now = Date.now();
  const store = new InMemorySessionStore();
  const session = new LiveSession(claims(now), fakeSocket(), now);
  session.addViewer({
    deviceLabel: 'Mac · Safari',
    approximateLocation: undefined,
    joinedVia: 'link',
    socket: fakeSocket(),
    now,
  });
  store.add(session);

  assert.equal(store.sweep(now + 13 * 60 * 60 * 1_000).length, 1, '12-hour ceiling');
});

test('the sweeper reports what it removed, so both sides can be told', async () => {
  // A session that vanishes without a word leaves the viewer on a frozen
  // frame, which is indistinguishable from a hung connection.
  const now = Date.now() - SESSION_TIMEOUTS.idleMs - 1_000;
  const store = new InMemorySessionStore();
  store.add(new LiveSession(claims(now), fakeSocket(), now));

  const expired: string[] = [];
  const stop = startSweeper(store, (session) => expired.push(session.sessionId), 20);

  await new Promise((resolve) => setTimeout(resolve, 120));
  stop();

  assert.equal(expired.length, 1, 'the sweeper ran and reported');
  assert.equal(store.size, 0);
});

test('sweeping an empty store does nothing and costs nothing', () => {
  const store = new InMemorySessionStore();
  assert.deepEqual(store.sweep(Date.now()), []);
});

test('the store times out a pending request and names the session it belongs to', () => {
  const now = Date.now();
  const store = new InMemorySessionStore();
  const session = new LiveSession(claims(now), fakeSocket(), now);
  const viewer = session.addViewer({
    deviceLabel: 'iPad · Safari',
    approximateLocation: undefined,
    joinedVia: 'link',
    socket: fakeSocket(),
    now,
  });
  store.add(session);

  assert.deepEqual(store.expireStaleJoinRequests(60_000, now + 30_000), [], 'not yet');

  const expired = store.expireStaleJoinRequests(60_000, now + 61_000);
  assert.equal(expired.length, 1);
  assert.equal(expired[0]?.session, session);
  assert.equal(expired[0]?.viewer.id, viewer.id);
  // Unlike a swept session, the session itself is untouched — only the
  // request that timed out.
  assert.equal(store.byId(session.sessionId), session);
});

test('a host reattaching replaces its session rather than duplicating it', () => {
  // Otherwise a reconnect leaves the old entry indexed under the same code,
  // and which one a viewer reaches depends on insertion order.
  const now = Date.now();
  const store = new InMemorySessionStore();
  const first = new LiveSession(claims(now), fakeSocket(), now);
  store.add(first);

  const again = new LiveSession(
    { ...claims(now), sid: first.sessionId, code: first.joinCode, tok: first.joinToken },
    fakeSocket(),
    now,
  );
  store.add(again);

  assert.equal(store.size, 1);
  assert.equal(store.byCode(first.joinCode), again);
});
