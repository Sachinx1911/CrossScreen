import assert from 'node:assert/strict';
import { test } from 'node:test';

import { IceCandidateQueue } from './ice-queue.ts';

/**
 * The bug this guards against was invisible locally and appeared the moment
 * real latency was introduced: candidates arriving before the answer were
 * thrown away, quietly discarding connection paths.
 */

function fakePeer() {
  const added = [];
  return {
    remoteDescription: null,
    added,
    addIceCandidate(candidate) {
      added.push(candidate);
      return Promise.resolve();
    },
  };
}

const candidate = (n) => ({ candidate: `candidate:${n}`, sdpMid: '0', sdpMLineIndex: 0 });

test('candidates arriving before a peer exists are held, not dropped', async () => {
  const queue = new IceCandidateQueue();
  await queue.add(candidate(1));
  await queue.add(candidate(2));
  assert.equal(queue.pendingCount, 2);
});

test('candidates are held until the remote description is set', async () => {
  const pc = fakePeer();
  const queue = new IceCandidateQueue();
  queue.attach(pc);

  await queue.add(candidate(1));
  assert.equal(pc.added.length, 0, 'must not be applied before the remote description');
  assert.equal(queue.pendingCount, 1);

  pc.remoteDescription = { type: 'answer' };
  await queue.flush();

  assert.equal(pc.added.length, 1);
  assert.equal(queue.pendingCount, 0);
});

test('order is preserved across the flush', async () => {
  const pc = fakePeer();
  const queue = new IceCandidateQueue(pc);
  for (const n of [1, 2, 3]) await queue.add(candidate(n));

  pc.remoteDescription = { type: 'answer' };
  await queue.flush();

  assert.deepEqual(
    pc.added.map((c) => c.candidate),
    ['candidate:1', 'candidate:2', 'candidate:3'],
  );
});

test('once ready, candidates go straight through', async () => {
  const pc = fakePeer();
  pc.remoteDescription = { type: 'answer' };
  const queue = new IceCandidateQueue(pc);

  await queue.add(candidate(1));
  assert.equal(pc.added.length, 1);
  assert.equal(queue.pendingCount, 0);
});

test('flushing early is a no-op rather than a loss', async () => {
  const pc = fakePeer();
  const queue = new IceCandidateQueue(pc);
  await queue.add(candidate(1));

  await queue.flush();
  assert.equal(queue.pendingCount, 1, 'the candidate must survive a premature flush');

  pc.remoteDescription = { type: 'answer' };
  await queue.flush();
  assert.equal(pc.added.length, 1);
});

test('a peer that rejects a candidate does not break the rest', async () => {
  const pc = fakePeer();
  pc.remoteDescription = { type: 'answer' };
  let calls = 0;
  pc.addIceCandidate = (c) => {
    calls += 1;
    if (calls === 1) return Promise.reject(new Error('malformed'));
    pc.added.push(c);
    return Promise.resolve();
  };

  const queue = new IceCandidateQueue(pc);
  await queue.add(candidate(1));
  await queue.add(candidate(2));

  assert.equal(pc.added.length, 1, 'the good candidate still went through');
});
