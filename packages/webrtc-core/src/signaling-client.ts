import {
  envelope,
  parseServerEnvelope,
  type ClientMessage,
  type ServerMessage,
} from '@crossscreen/protocol';

import { ReconnectSchedule, type BackoffPolicy } from './reconnect.ts';

/**
 * A thin, typed WebSocket client for the signaling protocol, which puts
 * itself back together when the connection drops.
 *
 * Phase 2's rule: a temporary network problem must never cost someone their
 * session code (phase-2-reliability.md §2.3). A dropped socket is the most
 * ordinary version of that — a Wi-Fi handover, a laptop lid, a service
 * restart — so this reconnects on its own rather than reporting failure and
 * leaving the session to be started again.
 *
 * What it deliberately does **not** do is decide what to say once the socket
 * is back. A host re-attaches with its host token and a viewer asks to join
 * again with the token it was issued; both are protocol decisions belonging to
 * the sessions, which is why `onReconnect` hands the moment back rather than
 * replaying whatever was sent before.
 */

export type SignalingState = 'connecting' | 'open' | 'reconnecting' | 'closed';

export class SignalingClient {
  #socket: WebSocket | undefined;
  #closedByUs = false;
  #onClose: (() => void) | undefined;
  #onReconnect: (() => void) | undefined;
  #onState: ((state: SignalingState) => void) | undefined;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;
  #state: SignalingState = 'connecting';
  readonly #schedule: ReconnectSchedule;
  readonly #handlers = new Map<string, Set<(m: ServerMessage) => void>>();

  readonly #url: string;

  constructor(url: string, policy?: BackoffPolicy) {
    this.#url = url;
    this.#schedule = new ReconnectSchedule(policy);
  }

  get state(): SignalingState {
    return this.#state;
  }

  /**
   * The first connection. Rejecting here rather than retrying is deliberate:
   * a session that cannot reach signaling at all has nothing to preserve, and
   * the caller needs to say so plainly instead of spinning.
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#setState('connecting');
      const socket = this.#open();

      socket.addEventListener('open', () => {
        resolve();
      });
      socket.addEventListener('error', () => {
        reject(new Error(`Could not reach signaling at ${this.#url}`));
      });
    });
  }

  #open(): WebSocket {
    const socket = new WebSocket(this.#url);
    this.#socket = socket;

    socket.onopen = (): void => {
      const reconnected = this.#schedule.attempt > 0;
      this.#schedule.reset();
      this.#setState('open');
      // Only after a genuine outage: the first connection is the session's own
      // business, and telling it to re-identify would duplicate the join.
      if (reconnected) this.#onReconnect?.();
    };

    socket.onclose = (): void => {
      if (this.#closedByUs) return;
      this.#scheduleRetry();
    };

    // Left to `onclose`, which fires after `onerror` for a failed connection —
    // handling both would schedule two retries for one failure.
    socket.onerror = (): void => undefined;

    socket.onmessage = (event: MessageEvent<string>) => {
      const parsed = parseServerEnvelope(event.data);
      if (!parsed.ok) {
        console.warn('[signaling] dropped frame', parsed.code, parsed.detail);
        return;
      }
      const message = parsed.value.payload;
      for (const handler of this.#handlers.get(message.type) ?? []) handler(message);
    };

    return socket;
  }

  /**
   * A socket that closed on its own means the service went away, the network
   * changed, or the machine slept. Retry on a spreading schedule, and only
   * report the session lost once the schedule gives up — at which point it
   * genuinely is, because the server will have swept it by then.
   */
  #scheduleRetry(): void {
    const delayMs = this.#schedule.next();
    if (delayMs === undefined) {
      this.#setState('closed');
      this.#onClose?.();
      return;
    }

    this.#setState('reconnecting');
    this.#retryTimer = setTimeout(() => {
      if (this.#closedByUs) return;
      this.#open();
    }, delayMs);
  }

  #setState(state: SignalingState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.#onState?.(state);
  }

  /** Subscribe to one message type. Returns an unsubscribe function. */
  on<T extends ServerMessage['type']>(
    type: T,
    handler: (message: Extract<ServerMessage, { type: T }>) => void,
  ): () => void {
    const set = this.#handlers.get(type) ?? new Set();
    set.add(handler as (m: ServerMessage) => void);
    this.#handlers.set(type, set);
    return () => set.delete(handler as (m: ServerMessage) => void);
  }

  /**
   * Called once reconnection has been given up on — never when we close it
   * ourselves, and never for a drop we are still retrying.
   */
  onClose(handler: () => void): void {
    this.#onClose = handler;
  }

  /**
   * Called when a dropped connection comes back, so the session can say who it
   * is again. Not called for the first connection.
   */
  onReconnect(handler: () => void): void {
    this.#onReconnect = handler;
  }

  /** Called on every transition, for showing "Reconnecting…" and taking it away. */
  onState(handler: (state: SignalingState) => void): void {
    this.#onState = handler;
  }

  send(message: ClientMessage): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) {
      // Dropped rather than queued on purpose. Everything sent here is about
      // right now — an offer, a candidate, an approval — and replaying it into
      // a reconnected session would negotiate against a peer that has moved on.
      console.warn('[signaling] not connected; dropping', message.type);
      return;
    }
    this.#socket.send(JSON.stringify(envelope(message)));
  }

  close(): void {
    this.#closedByUs = true;
    if (this.#retryTimer !== undefined) clearTimeout(this.#retryTimer);
    this.#retryTimer = undefined;
    this.#socket?.close();
    this.#socket = undefined;
    this.#setState('closed');
  }
}
