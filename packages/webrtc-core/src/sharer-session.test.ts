import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Emitter } from './events.ts';
import { qualityFrom, userFacingState } from './sharer-session.ts';
import type { ConnectionSnapshot } from './stats.ts';

/**
 * The parts of the sharer that can be reasoned about without a browser: the
 * translation from WebRTC's vocabulary into words a person can act on, the
 * quality thresholds, and the emitter everything reports through.
 *
 * The approval ordering itself is enforced by the server and tested there, over
 * a real socket — which is the right place for it. A client-side test could
 * only prove the client behaves, and the client is the part an attacker
 * replaces.
 */

test('every WebRTC state maps into the vocabulary the UI knows', () => {
  // The mapping has to be total: an unmapped state would surface as undefined
  // and the interface would show nothing at all, which reads as a freeze.
  const allowed = new Set([
    'connecting',
    'checking',
    'securing',
    'connected',
    'unstable',
    'reconnecting',
    'failed',
  ]);
  const states: RTCPeerConnectionState[] = [
    'new',
    'connecting',
    'connected',
    'disconnected',
    'failed',
    'closed',
  ];

  for (const state of states) {
    const translated = userFacingState(state);
    assert.ok(
      allowed.has(translated),
      `${state} produced "${translated}", which the UI cannot render`,
    );
  }
});

test('a dropped connection reads as unstable, not as failure', () => {
  // 'disconnected' is often temporary, and telling someone their session has
  // failed when it is about to recover is worse than saying nothing.
  assert.equal(userFacingState('disconnected'), 'unstable');
  assert.equal(userFacingState('failed'), 'failed');
  assert.equal(userFacingState('closed'), 'failed');
});

/** A snapshot with every field present, so a test can override just what it cares about. */
function snapshot(overrides: Partial<ConnectionSnapshot> = {}): ConnectionSnapshot {
  return {
    transport: 'direct',
    localCandidateType: 'host',
    remoteCandidateType: 'host',
    roundTripMs: undefined,
    availableOutgoingKbps: undefined,
    availableIncomingKbps: undefined,
    bitrateKbps: undefined,
    packetLossPct: undefined,
    framesPerSecond: undefined,
    resolution: undefined,
    codec: undefined,
    packetsLost: undefined,
    ...overrides,
  };
}

test('quality follows measured round-trip time', () => {
  const at = (roundTripMs: number) => qualityFrom(snapshot({ roundTripMs }));

  assert.equal(at(10), 'excellent');
  assert.equal(at(100), 'good');
  assert.equal(at(250), 'poor');
  assert.equal(at(900), 'unstable');
});

test('quality follows measured packet loss', () => {
  const at = (packetLossPct: number) => qualityFrom(snapshot({ packetLossPct }));

  assert.equal(at(0.5), 'excellent');
  assert.equal(at(2), 'good');
  assert.equal(at(4), 'poor');
  assert.equal(at(10), 'unstable');
});

test('quality follows available bandwidth, not what was actually sent', () => {
  // A static screen legitimately sends almost nothing while perfectly
  // healthy (maintain-resolution, architecture §9) — bandwidth is graded on
  // what the link *could* carry, never on what this particular frame needed.
  const at = (availableOutgoingKbps: number) => qualityFrom(snapshot({ availableOutgoingKbps }));

  assert.equal(at(5302), 'excellent'); // the macOS Phase 0.5 reading
  assert.equal(at(300), 'good'); // the Windows Phase 0.5 reading — still watchable
  assert.equal(at(200), 'poor');
  assert.equal(at(50), 'unstable');
});

test('a viewer with no outgoing estimate is graded on its incoming one', () => {
  assert.equal(
    qualityFrom(snapshot({ availableOutgoingKbps: undefined, availableIncomingKbps: 5302 })),
    'excellent',
  );
});

test('quality is the weakest measured dimension, not an average', () => {
  // A fine round-trip time next to 8% loss is not "good on balance" — it is
  // bad, and averaging would hide exactly the dimension worth seeing.
  assert.equal(qualityFrom(snapshot({ roundTripMs: 10, packetLossPct: 8 })), 'unstable');
  assert.equal(
    qualityFrom(snapshot({ roundTripMs: 10, packetLossPct: 0.1, availableOutgoingKbps: 200 })),
    'poor',
  );
});

test('an unmeasured connection is not reported as bad', () => {
  // Stats are absent for the first second or two of every session. Showing
  // "unstable" then would make every connection look broken as it starts.
  assert.equal(qualityFrom(snapshot()), 'good');
});

class Probe extends Emitter<{ tick: { n: number } }> {
  fire(n: number): void {
    this.emit('tick', { n });
  }
}

test('listeners receive events, and unsubscribe stops them', () => {
  const probe = new Probe();
  const seen: number[] = [];
  const off = probe.on('tick', (p) => seen.push(p.n));

  probe.fire(1);
  probe.fire(2);
  off();
  probe.fire(3);

  assert.deepEqual(seen, [1, 2]);
});

test('one listener throwing does not stop the others', () => {
  // A session reports progress to whatever is drawing the screen. A rendering
  // bug in one panel must not abort a negotiation in flight.
  const probe = new Probe();
  const seen: string[] = [];

  probe.on('tick', () => {
    throw new Error('a rendering bug');
  });
  probe.on('tick', () => seen.push('second listener still ran'));

  assert.doesNotThrow(() => probe.fire(1));
  assert.deepEqual(seen, ['second listener still ran']);
});
