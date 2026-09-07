import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';

import {
  SESSION_TIMEOUTS,
  type HostTokenClaims,
  type Participant,
  type SessionState,
  type SessionSummary,
} from '@crossscreen/protocol';

/**
 * A session that is actually happening.
 *
 * It exists only while the host is connected (ADR-0011). That is not a
 * limitation to work around: a session nobody is hosting has no screen to
 * show, and a viewer arriving early gets the same answer as someone guessing
 * codes — which is a free reinforcement of ADR-0006.
 *
 * The rule this class exists to enforce: **a viewer is `pending` until the
 * host approves, and nothing is relayed to a pending viewer.** Everything else
 * here is bookkeeping in service of that.
 */

export type ViewerState = 'pending' | 'approved' | 'rejected';

export interface Viewer {
  readonly id: string;
  /** Mutable: `rebindViewer` swaps this when a resumed viewer reconnects. */
  socket: WebSocket;
  readonly deviceLabel: string;
  readonly approximateLocation: string | undefined;
  readonly joinedVia: 'code' | 'link';
  readonly requestedAt: number;
  state: ViewerState;
  /** Issued on approval only. Scoped to this session and this participant. */
  token: string | undefined;
  approvedAt: number | undefined;
  /**
   * When this viewer's socket dropped, if it is currently gone.
   *
   * The host-side mirror of `LiveSession.hostAwaySince`, for the same reason:
   * a viewer losing signaling has not stopped watching — media is
   * peer-to-peer and the RTCPeerConnection never noticed — so this is held
   * rather than removed outright (phase-2-reliability.md §2.3).
   */
  awaySince: number | undefined;
}

export class LiveSession {
  readonly sessionId: string;
  readonly joinCode: string;
  readonly joinToken: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly hostId: string;

  hostSocket: WebSocket;
  endedReason: 'host_ended' | 'expired' | 'idle_timeout' | undefined;

  /** When the last viewer left, so the idle timeout has something to measure. */
  emptySince: number | undefined;

  /**
   * Whether any viewer has ever been added — pending counts, this is about
   * whether the session has been *found*, not watched. Distinguishes a
   * session nobody has discovered yet from one that was active and emptied,
   * which is why `SESSION_TIMEOUTS` gives the two different grace periods
   * (`unclaimedMs` vs `idleMs`) instead of one.
   */
  #everClaimed = false;

  /**
   * When the host's socket dropped, if it is currently gone.
   *
   * A host losing signaling is not a host ending the session: media is
   * peer-to-peer, so anyone watching still is, and the phase rule is that a
   * temporary network problem must never cost someone their code
   * (phase-2-reliability.md §2.3). The session is held for a grace period so
   * the same host can come back to it with the token it already has.
   */
  hostAwaySince: number | undefined;

  readonly #viewers = new Map<string, Viewer>();

  constructor(claims: HostTokenClaims, hostSocket: WebSocket, now = Date.now()) {
    this.sessionId = claims.sid;
    this.joinCode = claims.code;
    this.joinToken = claims.tok;
    this.createdAt = claims.iat * 1000;
    this.expiresAt = claims.exp * 1000;
    this.hostId = randomUUID();
    this.hostSocket = hostSocket;
    this.emptySince = now;
  }

  get viewers(): readonly Viewer[] {
    return [...this.#viewers.values()];
  }

  get approvedViewers(): readonly Viewer[] {
    return this.viewers.filter((v) => v.state === 'approved');
  }

  get state(): SessionState {
    if (this.endedReason === 'expired') return 'expired';
    if (this.endedReason !== undefined) return 'ended';
    return this.approvedViewers.length > 0 ? 'active' : 'waiting';
  }

  addViewer(input: {
    deviceLabel: string;
    approximateLocation: string | undefined;
    joinedVia: 'code' | 'link';
    socket: WebSocket;
    now?: number;
  }): Viewer {
    const viewer: Viewer = {
      id: randomUUID(),
      socket: input.socket,
      deviceLabel: input.deviceLabel,
      approximateLocation: input.approximateLocation,
      joinedVia: input.joinedVia,
      requestedAt: input.now ?? Date.now(),
      // Pending is the only state a viewer can start in. There is no path that
      // creates an approved one, by construction rather than by discipline.
      state: 'pending',
      token: undefined,
      approvedAt: undefined,
      awaySince: undefined,
    };
    this.#viewers.set(viewer.id, viewer);
    this.emptySince = undefined;
    this.#everClaimed = true;
    return viewer;
  }

  viewer(id: string): Viewer | undefined {
    return this.#viewers.get(id);
  }

  /**
   * Approve a pending viewer, issuing its participant token.
   *
   * Refuses a second approval while one is already active — Phase 1 is one
   * sharer, one viewer (architecture §11). The request gate is what a real
   * second visitor meets; this is the same rule enforced again for the
   * narrower case of two requests that were both already pending when the
   * host approved the first one.
   */
  approve(id: string, now = Date.now()): Viewer | undefined {
    if (this.approvedViewers.length > 0) return undefined;
    const viewer = this.#viewers.get(id);
    // Only a pending viewer can be approved. An already-approved or rejected
    // one falling through here is what would make approval re-openable.
    if (viewer?.state !== 'pending') return undefined;
    viewer.state = 'approved';
    viewer.approvedAt = now;
    viewer.token = randomUUID();
    return viewer;
  }

  reject(id: string): Viewer | undefined {
    const viewer = this.#viewers.get(id);
    if (viewer?.state !== 'pending') return undefined;
    viewer.state = 'rejected';
    return viewer;
  }

  removeViewer(id: string, now = Date.now()): boolean {
    const removed = this.#viewers.delete(id);
    if (removed && this.#viewers.size === 0) this.emptySince = now;
    return removed;
  }

  /**
   * Pending viewers who have waited past `timeoutMs` get an answer instead of
   * an indefinite one — the host may simply not be looking at the prompt.
   * Marked and removed the same way an explicit rejection is, so a request
   * that has already timed out cannot later be approved by a host who never
   * saw it expire.
   */
  expireStaleRequests(timeoutMs: number, now = Date.now()): Viewer[] {
    const stale = this.viewers.filter(
      (viewer) => viewer.state === 'pending' && now - viewer.requestedAt >= timeoutMs,
    );
    for (const viewer of stale) {
      viewer.state = 'rejected';
      this.removeViewer(viewer.id, now);
    }
    return stale;
  }

  /**
   * Approved viewers who have been away longer than the grace period are
   * genuinely gone — their own client stops retrying before this — and are
   * removed, so the host is told `peer.left` at that point rather than the
   * instant their socket happened to drop.
   */
  expireAwayViewers(graceMs: number, now = Date.now()): Viewer[] {
    const gone = this.viewers.filter(
      (viewer) => viewer.awaySince !== undefined && now - viewer.awaySince >= graceMs,
    );
    for (const viewer of gone) this.removeViewer(viewer.id, now);
    return gone;
  }

  /**
   * A previously approved viewer is back, on a new socket, presenting the
   * token it was issued at approval.
   *
   * Returns `undefined` for anything that does not check out — wrong token,
   * no such participant, already removed by `expireAwayViewers`, or never
   * approved in the first place — and the caller's answer to that is to treat
   * the request as an ordinary fresh one rather than an error. A resume that
   * cannot be honoured should look exactly like joining for the first time.
   */
  rebindViewer(participantId: string, token: string, socket: WebSocket): Viewer | undefined {
    const viewer = this.#viewers.get(participantId);
    if (viewer?.state !== 'approved' || viewer.token !== token) {
      return undefined;
    }
    viewer.socket = socket;
    viewer.awaySince = undefined;
    return viewer;
  }

  /**
   * Whether one participant may exchange WebRTC negotiation with another.
   *
   * This is the gate ADR-0006 rests on, and it is deliberately the only place
   * that answers the question. Relaying is allowed exactly between the host
   * and an **approved** viewer — never to a pending one, never between two
   * viewers, and never across sessions.
   */
  mayRelay(fromId: string, toId: string): boolean {
    if (fromId === toId) return false;

    if (fromId === this.hostId) {
      return this.#viewers.get(toId)?.state === 'approved';
    }
    if (toId === this.hostId) {
      return this.#viewers.get(fromId)?.state === 'approved';
    }
    // Viewer to viewer. There is no such thing in a 1-to-1 session, and
    // allowing it would let an approved viewer reach a pending one.
    return false;
  }

  socketFor(participantId: string): WebSocket | undefined {
    if (participantId === this.hostId) return this.hostSocket;
    return this.#viewers.get(participantId)?.socket;
  }

  /**
   * The host is back, on a new socket.
   *
   * Rebinding rather than rebuilding is the whole point: a fresh `LiveSession`
   * would have no viewers in it, so everyone watching would be unreachable for
   * negotiation and would have to ask permission again — which this phase
   * calls a failure, not a recovery.
   */
  rebindHost(socket: WebSocket): void {
    this.hostSocket = socket;
    this.hostAwaySince = undefined;
  }

  isExpired(
    now = Date.now(),
    timeouts: Pick<typeof SESSION_TIMEOUTS, 'idleMs' | 'unclaimedMs'> & {
      hostGraceMs?: number;
    } = SESSION_TIMEOUTS,
  ): boolean {
    if (now >= this.expiresAt) return true;

    // A host that has been gone longer than the grace period is not coming
    // back on this session: its own client stops retrying before this, so a
    // longer wait only holds a join code open for nobody.
    if (
      this.hostAwaySince !== undefined &&
      timeouts.hostGraceMs !== undefined &&
      now - this.hostAwaySince >= timeouts.hostGraceMs
    ) {
      return true;
    }

    if (this.emptySince === undefined) return false;

    // A session nobody has found yet gets longer to be found than one that
    // was watched and then emptied — the two are different situations, and
    // treating a fresh session as already "idle" would expire it under
    // people who are still reading the link they were just sent.
    const graceMs = this.#everClaimed ? timeouts.idleMs : timeouts.unclaimedMs;
    return now - this.emptySince >= graceMs;
  }

  /**
   * The public view. Pending viewers are included so the host can see who is
   * waiting; a viewer receives this too, which is why it carries no tokens and
   * no internal session id.
   */
  summary(): SessionSummary {
    const participants: Participant[] = [
      {
        participantId: this.hostId,
        role: 'host',
        state: 'connected',
        deviceLabel: 'Host',
        joinedAt: this.createdAt,
      },
      ...this.viewers.map((v): Participant => ({
        participantId: v.id,
        role: 'viewer',
        state:
          v.state === 'approved' ? 'connected' : v.state === 'rejected' ? 'rejected' : 'pending',
        deviceLabel: v.deviceLabel,
        ...(v.approvedAt === undefined ? {} : { joinedAt: v.approvedAt }),
      })),
    ];

    return {
      joinCode: this.joinCode,
      state: this.state,
      createdAt: this.createdAt,
      expiresAt: this.expiresAt,
      participants,
    };
  }
}
