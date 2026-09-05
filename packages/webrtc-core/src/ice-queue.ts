/**
 * Holds ICE candidates that arrive before the peer can accept them.
 *
 * Signaling delivers candidates and the offer/answer over the same channel,
 * and a peer starts producing candidates the moment it has a local
 * description — so candidates routinely arrive before the offer or answer
 * does. `addIceCandidate` throws in that state, and a discarded candidate is a
 * connection path silently thrown away.
 *
 * On a fast local connection the window is small enough that this rarely
 * shows. Add real latency — a tunnel, a mobile network — and it becomes the
 * common case, which is exactly when a lost candidate is most likely to have
 * been the one that would have worked.
 *
 * The queue is created before the peer connection exists, because on the
 * answering side candidates can arrive before there is anything to attach
 * them to.
 */
export class IceCandidateQueue {
  #pc: RTCPeerConnection | undefined;
  readonly #pending: RTCIceCandidateInit[] = [];

  constructor(pc?: RTCPeerConnection) {
    this.#pc = pc;
  }

  /** Bind a peer connection once it exists. Does not flush on its own: the
   *  remote description still has to be set first. */
  attach(pc: RTCPeerConnection): void {
    this.#pc = pc;
  }

  /** Add now if the peer is ready, otherwise hold until it is. */
  async add(candidate: RTCIceCandidateInit): Promise<void> {
    if (this.#pc === undefined || this.#pc.remoteDescription === null) {
      this.#pending.push(candidate);
      return;
    }
    await this.#apply(candidate);
  }

  /** Call immediately after setRemoteDescription. */
  async flush(): Promise<void> {
    if (this.#pc === undefined || this.#pc.remoteDescription === null) return;
    const queued = this.#pending.splice(0, this.#pending.length);
    for (const candidate of queued) await this.#apply(candidate);
  }

  get pendingCount(): number {
    return this.#pending.length;
  }

  async #apply(candidate: RTCIceCandidateInit): Promise<void> {
    try {
      await this.#pc?.addIceCandidate(candidate);
    } catch (err) {
      // A candidate the browser genuinely cannot parse is worth knowing about,
      // but it must not take the negotiation down with it.
      console.warn('[webrtc] could not add ICE candidate', err);
    }
  }
}
