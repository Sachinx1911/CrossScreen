/**
 * The limiter behind ADR-0006's numbers (phase-3a-production.md §3.1).
 *
 * `RATE_LIMITS` in `@crossscreen/protocol` has fixed the actual figures since
 * Phase 0 — 5 join-code attempts per IP per minute, 20 per hour, 20 session
 * creations per IP per hour — this is what enforces them. In-memory, per
 * ADR-0005: one node, no Redis, until traffic says otherwise.
 *
 * Kept pure and clock-injectable, the same reasoning `packages/webrtc-core`'s
 * `ReconnectSchedule` already applies to backoff: a decision this load-bearing
 * belongs behind something testable, not spread across request handlers.
 */

export interface RateLimitWindow {
  windowMs: number;
  /** Hits allowed inside this window before it is the one that refuses. */
  max: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /**
   * Only set when refused. A hint for the caller's own backoff, not the
   * server's re-admission time — the sliding windows above are what actually
   * decide when a key may try again; this is what makes repeat offenders
   * wait longer than a single window cycle would require.
   */
  retryAfterMs?: number;
}

interface KeyState {
  /** Timestamps of *allowed* hits still inside the largest configured window. A refusal is never pushed here — otherwise a client hammering the endpoint could grow this without bound. */
  hits: number[];
  /** Consecutive refusals since the last allowed hit. Reset to zero the moment one succeeds. */
  violations: number;
}

const BACKOFF_BASE_MS = 1_000;
/** An hour ceiling, matching the longest window these limits actually use. */
const BACKOFF_MAX_MS = 60 * 60 * 1_000;

export class RateLimiter {
  readonly #windows: readonly RateLimitWindow[];
  readonly #largestWindowMs: number;
  readonly #state = new Map<string, KeyState>();

  constructor(windows: RateLimitWindow[]) {
    if (windows.length === 0) throw new Error('RateLimiter needs at least one window');
    this.#windows = windows;
    this.#largestWindowMs = Math.max(...windows.map((w) => w.windowMs));
  }

  /**
   * Records one attempt against `key` and says whether it is allowed.
   * `key` is a hashed IP (`hashIp`, `@crossscreen/db`) or a session id —
   * never the raw address (architecture §42).
   */
  hit(key: string, now: number = Date.now()): RateLimitResult {
    const state = this.#state.get(key) ?? { hits: [], violations: 0 };
    state.hits = state.hits.filter((t) => now - t < this.#largestWindowMs);

    const exceeded = this.#windows.some(
      (w) => state.hits.filter((t) => now - t < w.windowMs).length >= w.max,
    );

    if (exceeded) {
      state.violations += 1;
      this.#state.set(key, state);
      return { allowed: false, retryAfterMs: this.#backoff(state.violations) };
    }

    state.hits.push(now);
    state.violations = 0;
    this.#state.set(key, state);
    return { allowed: true };
  }

  #backoff(violations: number): number {
    return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (violations - 1));
  }

  /**
   * Drops keys with nothing left worth remembering — no recent hits and no
   * standing violation streak — so a service that runs for weeks does not
   * accumulate one entry per address that has ever knocked once. Call this
   * periodically, the same way `SessionStore`'s sweep is scheduled.
   */
  sweep(now: number = Date.now()): void {
    for (const [key, state] of this.#state) {
      const recentHits = state.hits.filter((t) => now - t < this.#largestWindowMs);
      if (recentHits.length === 0 && state.violations === 0) {
        this.#state.delete(key);
      } else {
        state.hits = recentHits;
      }
    }
  }

  /** For tests and the sweep's own logging. */
  get size(): number {
    return this.#state.size;
  }
}
