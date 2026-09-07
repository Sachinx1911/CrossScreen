import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  classifyTransport,
  deriveBitrateKbps,
  derivePacketLossPct,
  formatSnapshot,
  type RawCounters,
} from './stats.ts';

/**
 * The direct-versus-relay classification decides the one number that predicts
 * future TURN cost (ADR-0004), so it is worth pinning down. The subtle case is
 * that a relay on *either* end makes the connection relayed.
 */

test('a relay on either end makes the connection relayed', () => {
  assert.equal(classifyTransport('relay', 'host'), 'relay');
  assert.equal(classifyTransport('host', 'relay'), 'relay');
  assert.equal(classifyTransport('relay', 'relay'), 'relay');
});

test('host and reflexive candidates are direct', () => {
  assert.equal(classifyTransport('host', 'host'), 'direct');
  assert.equal(classifyTransport('srflx', 'srflx'), 'direct');
  assert.equal(classifyTransport('host', 'srflx'), 'direct');
  assert.equal(classifyTransport('prflx', 'host'), 'direct');
});

test('an unknown end is reported as unknown rather than guessed', () => {
  assert.equal(classifyTransport(undefined, 'host'), 'unknown');
  assert.equal(classifyTransport('host', undefined), 'unknown');
  assert.equal(classifyTransport(undefined, undefined), 'unknown');
});

test('a snapshot formats to one readable line, omitting what is missing', () => {
  const line = formatSnapshot({
    transport: 'relay',
    localCandidateType: 'relay',
    remoteCandidateType: 'srflx',
    roundTripMs: 42,
    availableOutgoingKbps: undefined,
    availableIncomingKbps: undefined,
    bitrateKbps: undefined,
    packetLossPct: undefined,
    framesPerSecond: 14.7,
    resolution: '1920x1080',
    codec: 'VP9',
    packetsLost: undefined,
  });

  assert.match(line, /transport=relay/);
  assert.match(line, /path=relay->srflx/);
  assert.match(line, /rtt=42ms/);
  assert.match(line, /fps=15/);
  assert.match(line, /res=1920x1080/);
  assert.ok(!line.includes('avail='), 'missing values should be omitted, not printed as undefined');
  assert.ok(!line.includes('bitrate='));
  assert.ok(!line.includes('loss='));
});

/**
 * `deriveBitrateKbps` and `derivePacketLossPct` are the two functions that
 * turn "a number reported once" into "a rate over an interval" — the part of
 * §2.4/§2.5 that needed real thought, since `getStats()` only ever hands back
 * cumulative counters.
 */

function counters(overrides: Partial<RawCounters> = {}): RawCounters {
  return {
    timestampMs: 0,
    bytesTransferred: undefined,
    packetsLost: undefined,
    packetsTotal: undefined,
    ...overrides,
  };
}

test('bitrate needs two samples — the first one alone reports nothing', () => {
  assert.equal(
    deriveBitrateKbps(undefined, counters({ bytesTransferred: 1000, timestampMs: 1000 })),
    undefined,
  );
});

test('bitrate is bytes converted to kbit/s over the real interval between two samples', () => {
  const previous = counters({ bytesTransferred: 0, timestampMs: 0 });
  // 125,000 bytes in one second = 1,000,000 bits/s = 1000 kbit/s.
  const current = counters({ bytesTransferred: 125_000, timestampMs: 1000 });
  assert.equal(deriveBitrateKbps(previous, current), 1000);
});

test('a renegotiation resetting the byte counter reports no bitrate rather than a negative one', () => {
  const previous = counters({ bytesTransferred: 50_000, timestampMs: 0 });
  const current = counters({ bytesTransferred: 1_000, timestampMs: 1000 });
  assert.equal(deriveBitrateKbps(previous, current), undefined);
});

test('a stopped clock reports no bitrate rather than dividing by nothing', () => {
  const previous = counters({ bytesTransferred: 0, timestampMs: 1000 });
  const current = counters({ bytesTransferred: 500, timestampMs: 1000 });
  assert.equal(deriveBitrateKbps(previous, current), undefined);
});

test('the first packet-loss sample falls back to the cumulative ratio', () => {
  // Reporting nothing at all for the first two seconds of every connection
  // would leave an early failure invisible for no reason.
  const first = counters({ packetsLost: 5, packetsTotal: 95 });
  assert.equal(derivePacketLossPct(undefined, first), 5);
});

test('packet loss after the first sample is measured over the interval, not cumulatively', () => {
  // A connection that lost 50% of its first ten packets and none of its next
  // thousand is fine now — the cumulative ratio would keep calling it bad
  // long after it recovered.
  const previous = counters({ packetsLost: 5, packetsTotal: 5 });
  const current = counters({ packetsLost: 5, packetsTotal: 1005 });
  assert.equal(derivePacketLossPct(previous, current), 0);
});

test('packet loss rounds to one decimal place', () => {
  const previous = counters({ packetsLost: 0, packetsTotal: 0 });
  const current = counters({ packetsLost: 1, packetsTotal: 2 });
  assert.equal(derivePacketLossPct(previous, current), 33.3);
});

test('a counter reset reports no loss percentage rather than a negative one', () => {
  const previous = counters({ packetsLost: 50, packetsTotal: 500 });
  const current = counters({ packetsLost: 1, packetsTotal: 10 });
  assert.equal(derivePacketLossPct(previous, current), undefined);
});
