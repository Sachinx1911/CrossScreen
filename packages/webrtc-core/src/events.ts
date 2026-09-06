/**
 * A minimal typed event emitter.
 *
 * The session objects have to report progress to whatever is drawing the
 * screen without knowing what that is — a vanilla page today, React shortly,
 * and Electron's renderer alongside. Node's EventEmitter is not available in a
 * browser bundle, and a library for thirty lines that need to be exactly typed
 * is more surface than substance.
 */
// `object` rather than `Record<string, unknown>`: an interface with fixed keys
// has no index signature, so the stricter constraint would reject exactly the
// precisely-typed event maps this exists to support.
export class Emitter<Events extends object> {
  readonly #handlers = new Map<keyof Events, Set<(payload: never) => void>>();

  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): () => void {
    const set = this.#handlers.get(event) ?? new Set();
    set.add(handler);
    this.#handlers.set(event, set);
    return () => set.delete(handler);
  }

  protected emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const handler of this.#handlers.get(event) ?? []) {
      try {
        (handler as (p: Events[K]) => void)(payload);
      } catch (err) {
        // One misbehaving listener must not stop the others, and must not
        // abort the negotiation that was reporting to it.
        console.error(`[events] listener for ${String(event)} threw`, err);
      }
    }
  }

  protected clearListeners(): void {
    this.#handlers.clear();
  }
}
