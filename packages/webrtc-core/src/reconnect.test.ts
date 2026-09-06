import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  backoffDelay,
  withJitter,
  ReconnectSchedule,
  DEFAULT_BACKOFF,
  type BackoffPolicy,
} from './reconnect.ts';

/**
 * The schedule decides how long someone stares at a frozen picture before
 * either the session comes back or they are told it is gone. Both ends of
 * that are worth pinning down: too slow and a Wi-Fi handover looks fatal, too
 * eager and a recovering server is knocked over by its own returning clients.
 */

const policy: BackoffPolicy = {
  initialDelayMs: 100,
  maxDelayMs: 800,
  factor: 2,
  jitterRatio: 0,
  maxElapsedMs: 5_000,
};

test('the first retry is prompt, and each one after it doubles', () => {
  assert.equal(backoffDelay(1, policy), 100);
  assert.equal(backoffDelay(2, policy), 200);
  assert.equal(backoffDelay(3, policy), 400);
  assert.equal(backoffDelay(4, policy), 800);
});

test('the delay stops growing at the ceiling', () => {
  // Otherwise a long outage ends with everyone waiting minutes to notice it
  // ended, which is indistinguishable from the session being dead.
  assert.equal(backoffDelay(5, policy), 800);
  assert.equal(backoffDelay(20, policy), 800);
  assert.equal(backoffDelay(200, policy), 800, 'no overflow into Infinity');
});

test('an attempt number below one still produces the initial delay', () => {
  assert.equal(backoffDelay(0, policy), 100);
  assert.equal(backoffDelay(-3, policy), 100);
});

test('jitter spreads both ways around the scheduled delay', () => {
  const jittered: BackoffPolicy = { ...policy, jitterRatio: 0.5 };
  // random() of 0 is the bottom of the range, 1 the top, 0.5 the centre.
  assert.equal(
    withJitter(1_000, jittered, () => 0),
    500,
  );
  assert.equal(
    withJitter(1_000, jittered, () => 0.5),
    1_000,
  );
  assert.equal(
    withJitter(1_000, jittered, () => 0.999),
    1_499,
  );
});

test('jitter never produces a negative delay', () => {
  const wild: BackoffPolicy = { ...policy, jitterRatio: 5 };
  assert.equal(
    withJitter(10, wild, () => 0),
    0,
  );
});

test('the default policy retries within a second and gives up within a minute', () => {
  // The numbers themselves are a product decision; this is here so changing
  // them is deliberate rather than incidental.
  assert.ok(backoffDelay(1) <= 1_000, 'the first retry is fast enough to feel like recovery');
  assert.equal(DEFAULT_BACKOFF.maxElapsedMs, 60_000);
});

test('a schedule hands out growing delays, then gives up', () => {
  const schedule = new ReconnectSchedule(policy);
  const start = 1_000;

  assert.equal(
    schedule.next(start, () => 0.5),
    100,
  );
  assert.equal(
    schedule.next(start + 100, () => 0.5),
    200,
  );
  assert.equal(
    schedule.next(start + 300, () => 0.5),
    400,
  );
  assert.equal(schedule.attempt, 3);

  // Past maxElapsedMs, the answer is "stop", not "wait longer".
  assert.equal(
    schedule.next(start + 5_001, () => 0.5),
    undefined,
  );
});

test('giving up is decided by elapsed time, not attempt count', () => {
  // Someone on a flapping connection can burn through many attempts quickly;
  // what matters is how long they have been waiting, not how busy we were.
  const schedule = new ReconnectSchedule(policy);
  const start = 0;
  for (let i = 0; i < 50; i += 1) schedule.next(start, () => 0.5);
  assert.notEqual(
    schedule.next(start + 4_999, () => 0.5),
    undefined,
    'still inside the window',
  );
  assert.equal(
    schedule.next(start + 5_000, () => 0.5),
    undefined,
  );
});

test('reconnecting resets the schedule, so the next outage starts fresh', () => {
  const schedule = new ReconnectSchedule(policy);
  schedule.next(0, () => 0.5);
  schedule.next(100, () => 0.5);
  assert.equal(schedule.attempt, 2);

  schedule.reset();

  assert.equal(schedule.attempt, 0);
  assert.equal(
    schedule.next(10_000, () => 0.5),
    100,
    'back to the initial delay',
  );
  // And the give-up clock restarted too, rather than counting the first outage.
  assert.notEqual(
    schedule.next(14_000, () => 0.5),
    undefined,
  );
});
