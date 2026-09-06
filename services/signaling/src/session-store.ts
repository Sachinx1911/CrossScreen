import { SESSION_TIMEOUTS } from '@crossscreen/protocol';

import type { LiveSession, Viewer } from './live-session.ts';

/** One pending request that timed out, and the session it belonged to. */
export interface StaleJoinRequest {
  session: LiveSession;
  viewer: Viewer;
}

/**
 * Where live sessions live.
 *
 * An interface with one in-memory implementation, per ADR-0005: Redis earns
 * nothing on a single node, and the interface is what keeps adding it later a
 * swap rather than a rewrite. Every access to live session state goes through
 * here, so there is one place to change.
 */
export interface SessionStore {
  add(session: LiveSession): void;
  byId(sessionId: string): LiveSession | undefined;
  byCode(joinCode: string): LiveSession | undefined;
  byToken(joinToken: string): LiveSession | undefined;
  remove(sessionId: string): void;
  /** Drop expired sessions, returning those removed so callers can notify. */
  sweep(now?: number): LiveSession[];
  /** Reject pending viewers who have waited past the join-request timeout. */
  expireStaleJoinRequests(timeoutMs: number, now?: number): StaleJoinRequest[];
  readonly size: number;
}

export class InMemorySessionStore implements SessionStore {
  readonly #byId = new Map<string, LiveSession>();
  // Secondary indexes rather than a scan: a viewer arrives with only a code or
  // a token, and this is the hot path for every join.
  readonly #byCode = new Map<string, LiveSession>();
  readonly #byToken = new Map<string, LiveSession>();

  get size(): number {
    return this.#byId.size;
  }

  add(session: LiveSession): void {
    // A host reattaching replaces its own session rather than duplicating it.
    const existing = this.#byId.get(session.sessionId);
    if (existing !== undefined) this.remove(existing.sessionId);

    this.#byId.set(session.sessionId, session);
    this.#byCode.set(session.joinCode, session);
    this.#byToken.set(session.joinToken, session);
  }

  byId(sessionId: string): LiveSession | undefined {
    return this.#byId.get(sessionId);
  }

  byCode(joinCode: string): LiveSession | undefined {
    return this.#byCode.get(joinCode);
  }

  byToken(joinToken: string): LiveSession | undefined {
    return this.#byToken.get(joinToken);
  }

  remove(sessionId: string): void {
    const session = this.#byId.get(sessionId);
    if (session === undefined) return;
    this.#byId.delete(sessionId);
    this.#byCode.delete(session.joinCode);
    this.#byToken.delete(session.joinToken);
  }

  sweep(now = Date.now()): LiveSession[] {
    const expired: LiveSession[] = [];
    for (const session of this.#byId.values()) {
      if (session.isExpired(now)) expired.push(session);
    }
    for (const session of expired) this.remove(session.sessionId);
    return expired;
  }

  expireStaleJoinRequests(timeoutMs: number, now = Date.now()): StaleJoinRequest[] {
    const expired: StaleJoinRequest[] = [];
    for (const session of this.#byId.values()) {
      for (const viewer of session.expireStaleRequests(timeoutMs, now)) {
        expired.push({ session, viewer });
      }
    }
    return expired;
  }
}

/**
 * Run the sweeper.
 *
 * Sessions have to expire on a timer as well as on disconnect, because the
 * cases that matter most — a host whose laptop slept, a session nobody ever
 * joined — produce no event to react to.
 */
export function startSweeper(
  store: SessionStore,
  onExpired: (session: LiveSession) => void,
  intervalMs = 30_000,
): () => void {
  const timer = setInterval(() => {
    for (const session of store.sweep()) {
      session.endedReason = session.emptySince === undefined ? 'expired' : 'idle_timeout';
      onExpired(session);
    }
  }, intervalMs);

  // Otherwise the timer alone keeps the process alive after everything else
  // has shut down.
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}

export { SESSION_TIMEOUTS };
