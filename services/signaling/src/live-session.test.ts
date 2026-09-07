import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SESSION_TIMEOUTS, type HostTokenClaims } from '@crossscreen/protocol';

import { LiveSession } from './live-session.ts';

/**
 * `mayRelay` is the gate ADR-0006 rests on. A join code is only safe because
 * it grants nothing on its own, and this is the single place that decides who
 * may exchange WebRTC negotiation with whom.
 *
 * A fake socket is enough: none of this touches the network.
 */

const fakeSocket = () =>
  ({
    readyState: 1,
    OPEN: 1,
    // Nothing in this file asserts on what is sent; it asserts on who is
    // *allowed* to be sent to, which is `mayRelay`'s job alone.
    send: () => undefined,
  }) as never;

function claims(now = Date.now()): HostTokenClaims {
  return {
    sid: crypto.randomUUID(),
    code: '482719',
    tok: 'A'.repeat(22),
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + 43_200,
  };
}

function sessionWithViewer() {
  const session = new LiveSession(claims(), fakeSocket());
  const viewer = session.addViewer({
    deviceLabel: 'Android · Chrome',
    approximateLocation: undefined,
    joinedVia: 'code',
    socket: fakeSocket(),
  });
  return { session, viewer };
}

test('a viewer starts pending, and nothing may be relayed to it', () => {
  const { session, viewer } = sessionWithViewer();

  assert.equal(viewer.state, 'pending');
  assert.equal(
    session.mayRelay(session.hostId, viewer.id),
    false,
    'THE gate: no SDP reaches a viewer the host has not approved',
  );
  assert.equal(session.mayRelay(viewer.id, session.hostId), false);
});

test('a pending viewer holds no token', () => {
  // The participant token is the thing that says "approved". Issuing one
  // before approval would make the state meaningless.
  const { viewer } = sessionWithViewer();
  assert.equal(viewer.token, undefined);
  assert.equal(viewer.approvedAt, undefined);
});

test('approval opens the relay, in both directions', () => {
  const { session, viewer } = sessionWithViewer();
  session.approve(viewer.id);

  assert.equal(viewer.state, 'approved');
  assert.ok(viewer.token, 'approval issues the participant token');
  assert.equal(session.mayRelay(session.hostId, viewer.id), true);
  assert.equal(session.mayRelay(viewer.id, session.hostId), true);
});

test('a rejected viewer never becomes relayable', () => {
  const { session, viewer } = sessionWithViewer();
  session.reject(viewer.id);

  assert.equal(viewer.state, 'rejected');
  assert.equal(session.mayRelay(session.hostId, viewer.id), false);
  // And it cannot be approved afterwards — only a pending viewer can be.
  assert.equal(session.approve(viewer.id), undefined);
  assert.equal(session.mayRelay(session.hostId, viewer.id), false);
});

test('approving twice is not a way to re-open a rejected viewer', () => {
  const { session, viewer } = sessionWithViewer();
  assert.ok(session.approve(viewer.id));
  assert.equal(session.approve(viewer.id), undefined, 'already approved is not pending');
});

test('a second viewer cannot be approved while one already is (Phase 1: one at a time)', () => {
  const session = new LiveSession(claims(), fakeSocket());
  const add = () =>
    session.addViewer({
      deviceLabel: 'Android · Chrome',
      approximateLocation: undefined,
      joinedVia: 'code',
      socket: fakeSocket(),
    });

  const first = add();
  const second = add();
  assert.ok(session.approve(first.id));

  assert.equal(session.approve(second.id), undefined, 'already full');
  assert.equal(second.state, 'pending', 'left exactly as it was, not silently rejected');
  assert.equal(session.approvedViewers.length, 1);
});

test('an approved viewer cannot reach a pending one', () => {
  const session = new LiveSession(claims(), fakeSocket());
  const add = () =>
    session.addViewer({
      deviceLabel: 'Windows · Chrome',
      approximateLocation: undefined,
      joinedVia: 'code',
      socket: fakeSocket(),
    });

  const approved = add();
  const pending = add();
  session.approve(approved.id);

  assert.equal(session.mayRelay(approved.id, pending.id), false);
  assert.equal(session.mayRelay(pending.id, approved.id), false);
});

test('a participant cannot relay to itself, or to a stranger', () => {
  const { session, viewer } = sessionWithViewer();
  session.approve(viewer.id);

  assert.equal(session.mayRelay(session.hostId, session.hostId), false);
  assert.equal(session.mayRelay(viewer.id, viewer.id), false);
  assert.equal(session.mayRelay(session.hostId, crypto.randomUUID()), false);
  assert.equal(session.mayRelay(crypto.randomUUID(), session.hostId), false);
});

test('the summary carries no tokens and no internal session id', () => {
  const { session, viewer } = sessionWithViewer();
  session.approve(viewer.id);

  const serialised = JSON.stringify(session.summary());
  assert.ok(!serialised.includes(session.sessionId), 'internal id must stay private');
  assert.ok(!serialised.includes(viewer.token ?? 'x'), 'participant token must not be broadcast');
  assert.ok(!serialised.includes(session.joinToken), 'the link token is not for viewers');
  assert.ok(serialised.includes('482719'), 'the join code is fine to show');
});

test('a session is waiting until someone is approved, then active', () => {
  const { session, viewer } = sessionWithViewer();
  assert.equal(session.state, 'waiting', 'a pending viewer does not make a session active');
  session.approve(viewer.id);
  assert.equal(session.state, 'active');
});

test('a session nobody has ever joined gets the unclaimed grace period, not the idle one', () => {
  // Never claimed: nobody has been asked yet. Judging it as "idle" would
  // expire it under a host who is still typing the link to send.
  const now = Date.now();
  const session = new LiveSession(claims(now), fakeSocket(), now);

  assert.equal(session.isExpired(now), false);
  assert.equal(session.isExpired(now + 6 * 60 * 1000), false, 'idleMs alone is not enough here');
  assert.equal(session.isExpired(now + 11 * 60 * 1000), true, 'unclaimed for 10 minutes');
});

test('a session that was claimed and then emptied gets the shorter idle grace period', () => {
  const now = Date.now();
  const session = new LiveSession(claims(now), fakeSocket(), now);
  const viewer = session.addViewer({
    deviceLabel: 'Windows · Chrome',
    approximateLocation: undefined,
    joinedVia: 'code',
    socket: fakeSocket(),
    now,
  });
  session.removeViewer(viewer.id, now);

  assert.equal(session.isExpired(now + 4 * 60 * 1000), false);
  assert.equal(session.isExpired(now + 6 * 60 * 1000), true, 'idle for 5 minutes, not 10');
});

test('the unclaimed and idle grace periods are each overridable independently', () => {
  const now = Date.now();
  const unclaimed = new LiveSession(claims(now), fakeSocket(), now);
  const claimedThenEmptied = new LiveSession(claims(now), fakeSocket(), now);
  const viewer = claimedThenEmptied.addViewer({
    deviceLabel: 'Windows · Chrome',
    approximateLocation: undefined,
    joinedVia: 'code',
    socket: fakeSocket(),
    now,
  });
  claimedThenEmptied.removeViewer(viewer.id, now);

  const timeouts = { idleMs: 1_000, unclaimedMs: 2_000 };
  assert.equal(unclaimed.isExpired(now + 1_500, timeouts), false, 'not unclaimed-expired yet');
  assert.equal(unclaimed.isExpired(now + 2_500, timeouts), true);
  assert.equal(claimedThenEmptied.isExpired(now + 1_500, timeouts), true, 'idle grace is shorter');
});

test('a viewer keeps the session alive, and leaving restarts the clock', () => {
  const now = Date.now();
  const session = new LiveSession(claims(now), fakeSocket(), now);
  const viewer = session.addViewer({
    deviceLabel: 'Mac · Safari',
    approximateLocation: undefined,
    joinedVia: 'link',
    socket: fakeSocket(),
    now,
  });

  assert.equal(session.isExpired(now + 60 * 60 * 1000), false, 'occupied sessions do not idle out');

  session.removeViewer(viewer.id, now + 60 * 60 * 1000);
  assert.equal(session.isExpired(now + 60 * 60 * 1000 + 6 * 60 * 1000), true);
});

test('a pending viewer past the join-request timeout is rejected', () => {
  const now = Date.now();
  const session = new LiveSession(claims(now), fakeSocket());
  const viewer = session.addViewer({
    deviceLabel: 'Android · Chrome',
    approximateLocation: undefined,
    joinedVia: 'code',
    socket: fakeSocket(),
    now,
  });

  const stillWaiting = session.expireStaleRequests(60_000, now + 30_000);
  assert.deepEqual(stillWaiting, [], 'not yet 60 seconds');
  assert.equal(viewer.state, 'pending');

  const timedOut = session.expireStaleRequests(60_000, now + 61_000);
  assert.equal(timedOut.length, 1);
  assert.equal(timedOut[0]?.id, viewer.id);
  assert.equal(viewer.state, 'rejected');
  assert.equal(session.viewer(viewer.id), undefined, 'removed the same as an explicit rejection');
});

test('an approved viewer is left alone by the join-request timeout', () => {
  const { session, viewer } = sessionWithViewer();
  session.approve(viewer.id);

  const expired = session.expireStaleRequests(0, Date.now() + 1_000);
  assert.deepEqual(expired, [], 'approval already answered the request');
  assert.equal(viewer.state, 'approved');
});

test('a host being away briefly does not expire the session', () => {
  // The whole point of the grace period: a blip is not an ending, and the
  // people watching are still watching — media never went through that socket.
  const now = Date.now();
  const session = new LiveSession(claims(now), fakeSocket(), now);
  session.addViewer({
    deviceLabel: 'Android · Chrome',
    approximateLocation: undefined,
    joinedVia: 'code',
    socket: fakeSocket(),
    now,
  });
  session.hostAwaySince = now;

  const timeouts = { ...SESSION_TIMEOUTS, hostGraceMs: 90_000 };
  assert.equal(session.isExpired(now + 30_000, timeouts), false, 'still inside the grace period');
  assert.equal(session.isExpired(now + 91_000, timeouts), true, 'gone for good');
});

test('a host that comes back keeps the viewers it already approved', () => {
  const now = Date.now();
  const session = new LiveSession(claims(now), fakeSocket(), now);
  const viewer = session.addViewer({
    deviceLabel: 'Mac · Safari',
    approximateLocation: undefined,
    joinedVia: 'link',
    socket: fakeSocket(),
    now,
  });
  session.approve(viewer.id, now);
  session.hostAwaySince = now;

  const newSocket = fakeSocket();
  session.rebindHost(newSocket);

  assert.equal(session.hostAwaySince, undefined, 'no longer away');
  assert.equal(session.hostSocket, newSocket, 'talking over the new socket');
  assert.equal(session.approvedViewers.length, 1, 'the approval survived');
  assert.equal(
    session.mayRelay(session.hostId, viewer.id),
    true,
    'and negotiation can resume without asking again',
  );
  assert.equal(
    session.isExpired(now + 10 * 60_000, { ...SESSION_TIMEOUTS, hostGraceMs: 90_000 }),
    false,
  );
});

test('a resuming viewer presenting the right token gets its slot back', () => {
  const now = Date.now();
  const session = new LiveSession(claims(now), fakeSocket(), now);
  const viewer = session.addViewer({
    deviceLabel: 'Windows · Chrome',
    approximateLocation: undefined,
    joinedVia: 'code',
    socket: fakeSocket(),
    now,
  });
  session.approve(viewer.id, now);
  viewer.awaySince = now;
  const token = viewer.token;
  assert.ok(token);

  const newSocket = fakeSocket();
  const resumed = session.rebindViewer(viewer.id, token, newSocket);

  assert.equal(resumed, viewer);
  assert.equal(viewer.socket, newSocket, 'talking over the new socket');
  assert.equal(viewer.awaySince, undefined, 'no longer away');
  assert.equal(viewer.state, 'approved', 'still approved, not re-queued');
  assert.equal(session.mayRelay(session.hostId, viewer.id), true, 'negotiation can resume');
});

test('a resume attempt is refused for a wrong token, an unknown id, or a viewer never approved', () => {
  const now = Date.now();
  const session = new LiveSession(claims(now), fakeSocket(), now);
  const approved = session.addViewer({
    deviceLabel: 'Windows · Chrome',
    approximateLocation: undefined,
    joinedVia: 'code',
    socket: fakeSocket(),
    now,
  });
  session.approve(approved.id, now);

  const pending = session.addViewer({
    deviceLabel: 'Mac · Safari',
    approximateLocation: undefined,
    joinedVia: 'link',
    socket: fakeSocket(),
    now,
  });

  assert.equal(
    session.rebindViewer(approved.id, 'a-token-nobody-issued', fakeSocket()),
    undefined,
    'wrong token',
  );
  assert.equal(
    session.rebindViewer(crypto.randomUUID(), approved.token ?? '', fakeSocket()),
    undefined,
    'no such participant',
  );
  assert.equal(
    session.rebindViewer(pending.id, 'anything', fakeSocket()),
    undefined,
    'never approved — nothing to resume',
  );
});

test('an approved viewer being briefly away does not lose its slot', () => {
  // Mirrors the host-side grace test: a blip is not an ending, and the
  // picture is very likely still moving — media never touched that socket.
  const now = Date.now();
  const session = new LiveSession(claims(now), fakeSocket(), now);
  const viewer = session.addViewer({
    deviceLabel: 'Android · Chrome',
    approximateLocation: undefined,
    joinedVia: 'code',
    socket: fakeSocket(),
    now,
  });
  session.approve(viewer.id, now);
  viewer.awaySince = now;

  assert.deepEqual(
    session.expireAwayViewers(90_000, now + 30_000),
    [],
    'still inside the grace period',
  );
  assert.equal(session.viewer(viewer.id), viewer, 'not removed');

  const gone = session.expireAwayViewers(90_000, now + 91_000);
  assert.deepEqual(gone, [viewer]);
  assert.equal(session.viewer(viewer.id), undefined, 'removed once the grace period is up');
});

test('a viewer who never left is untouched by the away sweep', () => {
  const now = Date.now();
  const session = new LiveSession(claims(now), fakeSocket(), now);
  const viewer = session.addViewer({
    deviceLabel: 'Windows · Edge',
    approximateLocation: undefined,
    joinedVia: 'code',
    socket: fakeSocket(),
    now,
  });
  session.approve(viewer.id, now);

  assert.deepEqual(session.expireAwayViewers(90_000, now + 60 * 60_000), []);
  assert.equal(session.viewer(viewer.id), viewer);
});

test('with no host grace configured, a session is judged only on its other clocks', () => {
  // The protocol constants carry no opinion about host absence, so a caller
  // passing them unchanged must not have sessions expiring out from under it.
  const now = Date.now();
  const session = new LiveSession(claims(now), fakeSocket(), now);
  session.addViewer({
    deviceLabel: 'Windows · Edge',
    approximateLocation: undefined,
    joinedVia: 'code',
    socket: fakeSocket(),
    now,
  });
  session.hostAwaySince = now;

  assert.equal(session.isExpired(now + 60 * 60_000, SESSION_TIMEOUTS), false);
});

test('a session expires at its hard ceiling however busy it is', () => {
  const now = Date.now();
  const session = new LiveSession(claims(now), fakeSocket(), now);
  session.addViewer({
    deviceLabel: 'Windows · Edge',
    approximateLocation: undefined,
    joinedVia: 'code',
    socket: fakeSocket(),
    now,
  });

  assert.equal(session.isExpired(now + 13 * 60 * 60 * 1000), true, '12-hour ceiling');
});
