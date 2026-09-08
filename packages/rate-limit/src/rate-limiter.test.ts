import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RateLimiter } from './rate-limiter.ts';

/**
 * Two things matter here, in this order: that the two configured windows
 * (a tight minute one, a looser hourly one) each actually bind — a limiter
 * that only enforced the larger window would let a burst straight through —
 * and that a key which keeps getting refused waits longer each time, not the
 * same interval forever.
 */

test('the tighter window refuses before the looser one would', () => {
  const limiter = new RateLimiter([
    { windowMs: 60_000, max: 5 },
    { windowMs: 3_600_000, max: 20 },
  ]);
  const now = 0;

  for (let i = 0; i < 5; i += 1) {
    assert.equal(limiter.hit('ip-1', now + i).allowed, true);
  }
  const sixth = limiter.hit('ip-1', now + 5);
  assert.equal(sixth.allowed, false, 'the fifth hit already used up the per-minute window');
});

test('the looser window still refuses even inside the tighter one', () => {
  // 20/hour is stricter in aggregate than 5/minute once spread out — a
  // client pacing itself at one every 10 seconds never trips the minute
  // window but must still trip the hour one.
  const limiter = new RateLimiter([
    { windowMs: 60_000, max: 100 },
    { windowMs: 3_600_000, max: 20 },
  ]);
  const now = 0;

  for (let i = 0; i < 20; i += 1) {
    assert.equal(limiter.hit('ip-1', now + i * 10_000).allowed, true);
  }
  assert.equal(limiter.hit('ip-1', now + 20 * 10_000).allowed, false);
});

test('a refusal is not itself counted as a hit', () => {
  // Otherwise the array a spammer produces would grow without bound instead
  // of self-limiting at `max`.
  const limiter = new RateLimiter([{ windowMs: 60_000, max: 2 }]);
  const now = 0;
  limiter.hit('ip-1', now);
  limiter.hit('ip-1', now + 1);
  for (let i = 0; i < 50; i += 1) {
    limiter.hit('ip-1', now + 2 + i);
  }
  // Once the window rolls past the two real hits, exactly two more fit.
  assert.equal(limiter.hit('ip-1', now + 60_001).allowed, true);
  assert.equal(limiter.hit('ip-1', now + 60_002).allowed, true);
  assert.equal(limiter.hit('ip-1', now + 60_003).allowed, false);
});

test('the window clears once enough time has passed', () => {
  const limiter = new RateLimiter([{ windowMs: 1_000, max: 1 }]);
  assert.equal(limiter.hit('ip-1', 0).allowed, true);
  assert.equal(limiter.hit('ip-1', 500).allowed, false);
  assert.equal(limiter.hit('ip-1', 1_001).allowed, true, 'the first hit has aged out by now');
});

test('two different keys never see each other', () => {
  const limiter = new RateLimiter([{ windowMs: 60_000, max: 1 }]);
  assert.equal(limiter.hit('ip-1', 0).allowed, true);
  assert.equal(limiter.hit('ip-2', 0).allowed, true, 'a different address has its own budget');
});

test('being refused repeatedly waits longer each time', () => {
  const limiter = new RateLimiter([{ windowMs: 60_000, max: 1 }]);
  limiter.hit('ip-1', 0);

  const first = limiter.hit('ip-1', 1);
  const second = limiter.hit('ip-1', 2);
  const third = limiter.hit('ip-1', 3);

  assert.equal(first.allowed, false);
  assert.ok(first.retryAfterMs !== undefined);
  assert.ok(second.retryAfterMs! > first.retryAfterMs!);
  assert.ok(third.retryAfterMs! > second.retryAfterMs!);
});

test('one allowed hit resets the backoff, so recovering does not stay penalised', () => {
  const limiter = new RateLimiter([{ windowMs: 1_000, max: 1 }]);
  limiter.hit('ip-1', 0);
  const refused = limiter.hit('ip-1', 1);
  assert.equal(refused.allowed, false);

  // The window has cleared by now, so this one goes through — and it is
  // itself the one hit the window's `max: 1` allows, same as the very first.
  assert.equal(limiter.hit('ip-1', 1_001).allowed, true);

  // A fresh violation right after should back off from zero again, not
  // continue escalating from before the reset.
  const secondRefusal = limiter.hit('ip-1', 1_002);
  assert.equal(
    secondRefusal.retryAfterMs,
    refused.retryAfterMs,
    'backoff restarted, not continued',
  );
});

test('backoff has a ceiling', () => {
  const limiter = new RateLimiter([{ windowMs: 60_000, max: 1 }]);
  limiter.hit('ip-1', 0);
  let last: number | undefined;
  for (let i = 1; i <= 30; i += 1) {
    last = limiter.hit('ip-1', i).retryAfterMs;
  }
  assert.equal(last, 60 * 60 * 1_000);
});

test('sweeping drops a key with nothing recent and no standing violation', () => {
  const limiter = new RateLimiter([{ windowMs: 1_000, max: 5 }]);
  limiter.hit('ip-1', 0);
  assert.equal(limiter.size, 1);

  limiter.sweep(5_000);
  assert.equal(limiter.size, 0, 'the one hit aged out and there is no violation streak to keep');
});

test('sweeping keeps a key still mid-violation-streak even with no recent hits', () => {
  const limiter = new RateLimiter([{ windowMs: 1_000, max: 1 }]);
  limiter.hit('ip-1', 0);
  limiter.hit('ip-1', 1); // refused — the violation streak is what must survive a sweep
  limiter.sweep(10_000);
  assert.equal(limiter.size, 1);
});

test('an empty window list is refused at construction, not silently permissive', () => {
  assert.throws(() => new RateLimiter([]));
});
