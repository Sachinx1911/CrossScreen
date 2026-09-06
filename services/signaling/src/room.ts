import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';

import {
  envelope,
  errorMessage,
  SESSION_TIMEOUTS,
  type Participant,
  type ServerMessage,
} from '@crossscreen/protocol';

import { log } from './log.ts';

/**
 * The Phase 0.5 room: exactly two peers, no authentication, no approval.
 *
 * This is deliberately throwaway. Phase 1 replaces it with real sessions,
 * join codes and — the part that matters — mandatory host approval before any
 * SDP is relayed (ADR-0006). Nothing here should be treated as a foundation
 * to extend; the point of the skeleton is to prove the media path, not to be
 * the beginning of the session layer.
 */

export interface Peer {
  readonly id: string;
  readonly role: 'host' | 'viewer';
  readonly socket: WebSocket;
}

/** Fixed placeholder. Phase 1 generates these from a CSPRNG per session. */
const SKELETON_JOIN_CODE = '000000';

export class SkeletonRoom {
  readonly #peers = new Map<string, Peer>();
  readonly #createdAt = Date.now();

  get size(): number {
    return this.#peers.size;
  }

  /**
   * First peer in is the host, second is the viewer, a third is refused.
   * Returns null when the room is full so the caller can close the socket.
   */
  add(socket: WebSocket): Peer | null {
    if (this.#peers.size >= 2) return null;

    const peer: Peer = {
      id: randomUUID(),
      // Whether a host is already present, not how many peers there are. Those
      // agree until someone reconnects: if the host leaves and comes back, the
      // viewer is holding the only slot, so counting makes the returning sharer
      // a second 'viewer' and the room reports no host at all. Restarting the
      // sharer is not an edge case here — exit criterion 4 asks for it by name.
      role: this.#hasHost() ? 'viewer' : 'host',
      socket,
    };
    this.#peers.set(peer.id, peer);

    // The joining peer needs the full picture; everyone else needs the delta.
    this.send(peer, { type: 'session.state', session: this.#summary(), you: peer.id });
    this.broadcastExcept(peer.id, {
      type: 'peer.joined',
      participant: this.#participant(peer),
    });

    log.info('peer.joined', { peerId: peer.id, role: peer.role, roomSize: this.#peers.size });
    return peer;
  }

  remove(peerId: string): void {
    if (!this.#peers.delete(peerId)) return;
    this.broadcastExcept(peerId, { type: 'peer.left', participantId: peerId });
    log.info('peer.left', { peerId, roomSize: this.#peers.size });
  }

  get(peerId: string): Peer | undefined {
    return this.#peers.get(peerId);
  }

  #hasHost(): boolean {
    for (const peer of this.#peers.values()) {
      if (peer.role === 'host') return true;
    }
    return false;
  }

  /** The other peer, if there is one. In a two-peer room this is the target. */
  other(peerId: string): Peer | undefined {
    for (const peer of this.#peers.values()) {
      if (peer.id !== peerId) return peer;
    }
    return undefined;
  }

  send(peer: Peer, message: ServerMessage, inReplyTo?: string): void {
    if (peer.socket.readyState !== peer.socket.OPEN) return;
    peer.socket.send(JSON.stringify(envelope(message, inReplyTo)));
  }

  sendError(peer: Peer, code: Parameters<typeof errorMessage>[0], inReplyTo?: string): void {
    this.send(peer, errorMessage(code, inReplyTo));
  }

  broadcastExcept(exceptId: string, message: ServerMessage): void {
    for (const peer of this.#peers.values()) {
      if (peer.id !== exceptId) this.send(peer, message);
    }
  }

  #participant(peer: Peer): Participant {
    return {
      participantId: peer.id,
      role: peer.role,
      // The skeleton has no approval step, so a peer is connected on arrival.
      // In Phase 1 this starts as 'pending' and only the host can advance it.
      state: 'connected',
      deviceLabel: peer.role === 'host' ? 'Sharer' : 'Viewer',
      joinedAt: Date.now(),
    };
  }

  #summary() {
    return {
      joinCode: SKELETON_JOIN_CODE,
      state: this.#peers.size > 1 ? ('active' as const) : ('waiting' as const),
      createdAt: this.#createdAt,
      expiresAt: this.#createdAt + SESSION_TIMEOUTS.maxLifetimeMs,
      participants: [...this.#peers.values()].map((p) => this.#participant(p)),
    };
  }
}
