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
  readonly socket: WebSocket;
  readonly deviceLabel: string;
  readonly approximateLocation: string | undefined;
  readonly joinedVia: 'code' | 'link';
  readonly requestedAt: number;
  state: ViewerState;
  /** Issued on approval only. Scoped to this session and this participant. */
  token: string | undefined;
  approvedAt: number | undefined;
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
    };
    this.#viewers.set(viewer.id, viewer);
    this.emptySince = undefined;
    return viewer;
  }

  viewer(id: string): Viewer | undefined {
    return this.#viewers.get(id);
  }

  /** Approve a pending viewer, issuing its participant token. */
  approve(id: string, now = Date.now()): Viewer | undefined {
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

  isExpired(now = Date.now()): boolean {
    if (now >= this.expiresAt) return true;
    if (this.emptySince !== undefined && now - this.emptySince >= SESSION_TIMEOUTS.idleMs) {
      return true;
    }
    return false;
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
