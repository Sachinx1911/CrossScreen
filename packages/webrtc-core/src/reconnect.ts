/**
 * When to try again, and when to stop.
 *
 * Phase 2's rule is that a temporary network problem must never cost someone
 * their session code (phase-2-reliability.md §2.3). That makes the retry
 * schedule a product decision rather than a detail: retry too slowly and a
 * five-second Wi-Fi handover looks like a dead session; retry too eagerly and
 * a service coming back up is hit by every client it ever had, simultaneously.
 *
 * Kept pure, with `now` and `random` injected, because the risk register's
 * mitigation for "reconnection becomes the most complex code in the product"
 * is that its decisions live behind a state machine with unit tests rather
 * than being spread across UI components and timers.
 */

export interface BackoffPolicy {
  /** How long to wait before the first retry. */
  initialDelayMs: number;
  /** Ceiling per attempt, so a long outage still recovers promptly when it ends. */
  maxDelayMs: number;
  /** Multiplier applied per attempt. */
  factor: number;
  /** Fraction of each delay applied as random spread, ± this much. */
  jitterRatio: number;
  /** Total time to keep trying before the session is genuinely gone. */
  maxElapsedMs: number;
}

/**
 * Half a second, doubling to ten, giving up after a minute.
 *
 * The minute is set by the server, not chosen here: a session with nobody in
 * it is swept after `SESSION_TIMEOUTS.idleMs`, and there is no point retrying
 * into a session that has already been collected.
 */
export const DEFAULT_BACKOFF: BackoffPolicy = {
  initialDelayMs: 500,
  maxDelayMs: 10_000,
  factor: 2,
  jitterRatio: 0.25,
  maxElapsedMs: 60_000,
};

/**
 * The delay before a given attempt, before jitter. Attempt 1 is the first
 * retry, so the exponent starts at zero and the first wait is the initial one.
 */
export function backoffDelay(attempt: number, policy: BackoffPolicy = DEFAULT_BACKOFF): number {
  if (attempt < 1) return policy.initialDelayMs;
  const raw = policy.initialDelayMs * policy.factor ** (attempt - 1);
  return Math.min(raw, policy.maxDelayMs);
}

/**
 * Spread a delay by ±`jitterRatio`.
 *
 * Without this every client dropped by one service restart comes back at the
 * same instant, which is how a recovering server gets knocked over a second
 * time by the clients it just lost.
 */
export function withJitter(
  delayMs: number,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
  random: () => number = Math.random,
): number {
  const spread = delayMs * policy.jitterRatio;
  // random() is [0, 1); mapping to [-1, 1) keeps the delay centred on the
  // scheduled one rather than biasing every retry later than intended.
  return Math.max(0, Math.round(delayMs + spread * (random() * 2 - 1)));
}

/**
 * One reconnection attempt sequence.
 *
 * `next()` answers the only question the caller has — how long to wait, or
 * whether to stop — and `reset()` is called once a connection is established,
 * so the following outage starts from a short delay again rather than from
 * wherever the last one ended.
 */
export class ReconnectSchedule {
  readonly #policy: BackoffPolicy;
  #attempt = 0;
  #startedAt: number | undefined;

  constructor(policy: BackoffPolicy = DEFAULT_BACKOFF) {
    this.#policy = policy;
  }

  /** Attempts made so far in the current outage. Zero when connected. */
  get attempt(): number {
    return this.#attempt;
  }

  /**
   * How long to wait before the next attempt, or `undefined` to give up.
   *
   * The elapsed check is against when the outage began rather than a count of
   * attempts: what matters is how long the person has been staring at a
   * frozen picture, not how many times we tried in that time.
   */
  next(now: number = Date.now(), random: () => number = Math.random): number | undefined {
    this.#startedAt ??= now;
    if (now - this.#startedAt >= this.#policy.maxElapsedMs) return undefined;

    this.#attempt += 1;
    return withJitter(backoffDelay(this.#attempt, this.#policy), this.#policy, random);
  }

  /** Back to a clean slate, after a connection succeeds. */
  reset(): void {
    this.#attempt = 0;
    this.#startedAt = undefined;
  }
}
