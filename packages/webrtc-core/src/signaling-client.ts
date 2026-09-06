import {
  envelope,
  parseServerEnvelope,
  type ClientMessage,
  type ServerMessage,
} from '@crossscreen/protocol';

/**
 * A thin, typed WebSocket client for the signaling protocol.
 *
 * Reconnection and backoff are deliberately absent — they belong to Phase 2,
 * where they can be designed against real network-change behaviour rather than
 * guessed at now.
 */
export class SignalingClient {
  #socket: WebSocket | undefined;
  #closedByUs = false;
  #onClose: (() => void) | undefined;
  readonly #handlers = new Map<string, Set<(m: ServerMessage) => void>>();

  readonly #url: string;

  constructor(url: string) {
    this.#url = url;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.#url);
      this.#socket = socket;

      socket.onopen = (): void => {
        resolve();
      };

      socket.onclose = (): void => {
        // A socket that closes on its own means the service went away. Without
        // this the sharer sits there showing a join code that resolves to
        // nothing, and the person trying to use it is told the session does
        // not exist — with neither end able to work out why.
        if (!this.#closedByUs) this.#onClose?.();
      };
      socket.onerror = (): void => {
        reject(new Error(`Could not reach signaling at ${this.#url}`));
      };

      socket.onmessage = (event: MessageEvent<string>) => {
        const parsed = parseServerEnvelope(event.data);
        if (!parsed.ok) {
          console.warn('[signaling] dropped frame', parsed.code, parsed.detail);
          return;
        }
        const message = parsed.value.payload;
        for (const handler of this.#handlers.get(message.type) ?? []) handler(message);
      };
    });
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

  /** Called when the connection drops on its own, never when we close it. */
  onClose(handler: () => void): void {
    this.#onClose = handler;
  }

  send(message: ClientMessage): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) {
      console.warn('[signaling] not connected; dropping', message.type);
      return;
    }
    this.#socket.send(JSON.stringify(envelope(message)));
  }

  close(): void {
    this.#closedByUs = true;
    this.#socket?.close();
    this.#socket = undefined;
  }
}
