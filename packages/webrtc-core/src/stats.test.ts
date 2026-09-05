import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyTransport, formatSnapshot } from './stats.ts';

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
    bitrateKbps: undefined,
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
});
