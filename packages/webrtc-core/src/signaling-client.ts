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
  readonly #handlers = new Map<string, Set<(m: ServerMessage) => void>>();

  constructor(private readonly url: string) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.#socket = socket;

      socket.onopen = (): void => {
        resolve();
      };
      socket.onerror = (): void => {
        reject(new Error(`Could not reach signaling at ${this.url}`));
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

  send(message: ClientMessage): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) {
      console.warn('[signaling] not connected; dropping', message.type);
      return;
    }
    this.#socket.send(JSON.stringify(envelope(message)));
  }

  close(): void {
    this.#socket?.close();
    this.#socket = undefined;
  }
}
