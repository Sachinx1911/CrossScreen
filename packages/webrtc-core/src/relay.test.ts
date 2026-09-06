import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hasTurnServer } from './relay.ts';

test('STUN alone cannot relay', () => {
  assert.equal(hasTurnServer([{ urls: 'stun:stun.l.google.com:19302' }]), false);
});

test('a turn: or turns: server can', () => {
  assert.equal(hasTurnServer([{ urls: 'turn:turn.cloudflare.com:3478?transport=udp' }]), true);
  assert.equal(hasTurnServer([{ urls: 'turns:turn.cloudflare.com:5349?transport=tcp' }]), true);
});

test('a list of urls counts if any entry relays', () => {
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: ['stun:stun.example.com:3478', 'turn:turn.example.com:3478'] },
  ];
  assert.equal(hasTurnServer(servers), true);
});

test('a STUN host merely named "turn" is still not a relay', () => {
  // The reason the check reads the scheme rather than searching the string:
  // this would otherwise report a relay that does not exist, and the forced
  // relay run would go back to failing silently — the exact thing being
  // guarded against.
  assert.equal(hasTurnServer([{ urls: 'stun:turn.example.com:3478' }]), false);
});

test('no servers at all cannot relay', () => {
  assert.equal(hasTurnServer([]), false);
});
