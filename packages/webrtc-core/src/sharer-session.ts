import type { ConnectionState, JoinRequestInfo } from '@crossscreen/protocol';

import type { ApiClient, CreatedSession } from './api-client.ts';
import { Emitter } from './events.ts';
import { IceCandidateQueue } from './ice-queue.ts';
import { SignalingClient } from './signaling-client.ts';
import { formatSnapshot, readConnectionSnapshot, type ConnectionSnapshot } from './stats.ts';
import { tuneScreenShare, type QualityMode } from './tuning.ts';

/**
 * Sharing a screen, end to end, without knowing what is drawing the screen.
 *
 * Create a session, attach as host, wait for someone to ask, and — only once
 * the host has said yes — negotiate with them. That order is the product's
 * security model (ADR-0006), so it lives here rather than being reassembled
 * correctly by every interface that uses it.
 *
 * Framework-agnostic and event-driven, because the same flow has to serve a
 * browser tab, a React app, and Electron's renderer.
 */

export interface SharerEvents {
  /** Session created; the code and link can be shown. */
  ready: CreatedSession;
  /** Someone is asking to watch. Nothing has been sent to them. */
  pending: JoinRequestInfo;
  viewerJoined: { participantId: string };
  /** What is being shared was swapped mid-session. */
  streamChanged: { stream: MediaStream };
  quality: { mode: QualityMode };
  viewerLeft: { participantId: string };
  connection: { state: ConnectionState };
  stats: ConnectionSnapshot;
  /** The share ended — by us, by the OS, or by the far end. */
  ended: { reason: string };
  error: { message: string };
}

export interface SharerDependencies {
  api: ApiClient;
  signalingUrl: string;
  /**
   * Supplied rather than captured here: the shell owns the capture policy.
   * Mutable, because `replaceStream` swaps it mid-session.
   */
  stream: MediaStream;
}

/**
 * Translate an ICE state into words a person can read (architecture §67).
 * `RTCPeerConnectionState` is a debugging vocabulary; nobody should see
 * "failed" and be expected to know what to do about it.
 */
export function userFacingState(state: RTCPeerConnectionState): ConnectionState {
  switch (state) {
    case 'new':
      return 'connecting';
    case 'connecting':
      return 'checking';
    case 'connected':
      return 'connected';
    case 'disconnected':
      return 'unstable';
    case 'failed':
    case 'closed':
      return 'failed';
  }
}

/** Connection quality as the user sees it, from what was measured. */
export function qualityFrom(
  snapshot: ConnectionSnapshot,
): 'excellent' | 'good' | 'poor' | 'unstable' {
  const rtt = snapshot.roundTripMs;
  if (rtt === undefined) return 'good';
  if (rtt < 60) return 'excellent';
  if (rtt < 150) return 'good';
  if (rtt < 400) return 'poor';
  return 'unstable';
}

export class SharerSession extends Emitter<SharerEvents> {
  /** Everyone waiting on the host right now. */
  readonly pending = new Map<string, JoinRequestInfo>();

  #signaling: SignalingClient | undefined;
  readonly #peers = new Map<string, { pc: RTCPeerConnection; ice: IceCandidateQueue }>();
  #iceServers: RTCIceServer[] = [];
  #statsTimer: ReturnType<typeof setInterval> | undefined;
  #session: CreatedSession | undefined;
  #stopped = false;
  /**
   * Text by default, because the product's stated purpose is showing someone a
   * spreadsheet and having them able to read it (architecture §9). Sharing a
   * playing video is the case where that choice is wrong, which is why it is a
   * choice rather than a constant.
   */
  #quality: QualityMode = 'text';

  readonly #deps: SharerDependencies;

  constructor(deps: SharerDependencies) {
    super();
    this.#deps = deps;
  }

  get session(): CreatedSession | undefined {
    return this.#session;
  }

  async start(): Promise<CreatedSession> {
    // ICE configuration is fetched first so a failure surfaces as "could not
    // start" rather than as a connection that never completes for reasons
    // nobody can see.
    this.#iceServers = await this.#deps.api.iceServers();

    const session = await this.#deps.api.createSession();
    this.#session = session;

    const signaling = new SignalingClient(this.#deps.signalingUrl);
    this.#signaling = signaling;
    this.#wire(signaling);

    await signaling.connect();
    if (this.#stopped) {
      signaling.close();
      throw new Error('cancelled');
    }
    signaling.send({ type: 'session.host.attach', hostToken: session.hostToken });

    // The OS or the browser can end a capture without asking. Treat the track
    // ending as authoritative rather than assuming we are still sharing.
    this.#deps.stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      this.emit('ended', { reason: 'Your device stopped the screen share' });
      this.stop();
    });

    this.emit('ready', session);
    return session;
  }

  get quality(): QualityMode {
    return this.#quality;
  }

  /**
   * Switch between sharp text and smooth motion, live.
   *
   * Encoder parameters can be changed on a running sender, so this needs no
   * new offer and causes no interruption — the picture simply starts behaving
   * differently. Anyone watching stays connected.
   */
  async setQuality(mode: QualityMode): Promise<void> {
    this.#quality = mode;

    const track = this.#deps.stream.getVideoTracks()[0];
    for (const { pc } of this.#peers.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender === undefined || track === undefined) continue;
      await tuneScreenShare(track, sender, undefined, mode);
    }

    this.emit('quality', { mode });
  }

  /**
   * Swap what is being shared, without interrupting anyone watching.
   *
   * `replaceTrack` changes the outgoing media on an established connection, so
   * there is no new offer, no ICE, and no gap in the picture — viewers see the
   * new screen appear in place of the old one.
   *
   * The alternative is stopping and starting again, which drops every viewer
   * and makes each of them ask permission a second time. For the common case
   * this exists for — realising you picked the wrong window — that is a
   * disproportionate amount of ceremony.
   */
  async replaceStream(stream: MediaStream): Promise<void> {
    const track = stream.getVideoTracks()[0];
    if (track === undefined) {
      this.emit('error', { message: 'That screen could not be shared' });
      return;
    }

    const previous = this.#deps.stream;
    this.#deps.stream = stream;

    for (const { pc } of this.#peers.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender === undefined) continue;
      await sender.replaceTrack(track);
      // The new track needs the same treatment as the old one: a fresh track
      // carries none of the previous tuning, including the quality mode.
      await tuneScreenShare(track, sender, undefined, this.#quality);
    }

    // The OS can end this one too, and the old listener is attached to a track
    // that no longer matters.
    track.addEventListener('ended', () => {
      this.emit('ended', { reason: 'Your device stopped the screen share' });
      this.stop();
    });

    // Only after the swap has landed, so a failure leaves the old one running.
    if (previous !== stream) {
      previous.getTracks().forEach((t) => {
        t.stop();
      });
    }

    this.emit('streamChanged', { stream });
  }

  /** Let a waiting viewer in. Until this, nothing has been sent to them. */
  approve(participantId: string): void {
    this.pending.delete(participantId);
    this.#signaling?.send({ type: 'session.viewer.approve', participantId });
  }

  reject(participantId: string): void {
    this.pending.delete(participantId);
    this.#signaling?.send({ type: 'session.viewer.reject', participantId });
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;

    if (this.#statsTimer !== undefined) clearInterval(this.#statsTimer);
    this.#statsTimer = undefined;

    for (const { pc } of this.#peers.values()) pc.close();
    this.#peers.clear();
    this.pending.clear();

    this.#signaling?.send({ type: 'session.end' });
    this.#signaling?.close();
    this.#signaling = undefined;
  }

  #wire(signaling: SignalingClient): void {
    signaling.on('session.viewer.pending', (message) => {
      // Held, not acted on. The host decides, and until they do, this viewer
      // receives nothing at all.
      this.pending.set(message.request.participantId, message.request);
      this.emit('pending', message.request);
    });

    // Only ever sent after approval, which is what makes offering here safe.
    signaling.on('peer.joined', (message) => {
      void this.#offerTo(message.participant.participantId);
      this.emit('viewerJoined', { participantId: message.participant.participantId });
    });

    signaling.on('peer.left', (message) => {
      // Also clears anyone still waiting. A viewer who closes the tab before
      // being let in would otherwise leave a prompt on the host's screen for
      // someone who is no longer there — and the host could then allow them.
      this.pending.delete(message.participantId);
      this.#closePeer(message.participantId);
      this.emit('viewerLeft', { participantId: message.participantId });
    });

    signaling.on('rtc.answer', async (message) => {
      const peer = this.#peers.get(message.from);
      if (peer === undefined) return;
      await peer.pc.setRemoteDescription({ type: 'answer', sdp: message.sdp });
      await peer.ice.flush();
    });

    signaling.on('rtc.ice', async (message) => {
      await this.#peers.get(message.from)?.ice.add({
        candidate: message.candidate,
        sdpMid: message.sdpMid,
        sdpMLineIndex: message.sdpMLineIndex,
      });
    });

    signaling.on('session.ended', (message) => {
      this.emit('ended', { reason: message.reason });
      this.stop();
    });

    signaling.on('error', (message) => {
      this.emit('error', { message: message.userMessage });
    });
  }

  async #offerTo(participantId: string): Promise<void> {
    const signaling = this.#signaling;
    if (signaling === undefined) return;

    const pc = new RTCPeerConnection({ iceServers: this.#iceServers });
    const ice = new IceCandidateQueue(pc);
    this.#peers.set(participantId, { pc, ice });

    pc.onicecandidate = (event): void => {
      if (event.candidate === null) return;
      signaling.send({
        type: 'rtc.ice',
        to: participantId,
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
      });
    };

    pc.onconnectionstatechange = (): void => {
      this.emit('connection', { state: userFacingState(pc.connectionState) });
    };

    const track = this.#deps.stream.getVideoTracks()[0];
    if (track === undefined) {
      this.emit('error', { message: 'The screen share ended before it could be sent' });
      return;
    }

    const sender = pc.addTrack(track, this.#deps.stream);
    const transceiver = pc.getTransceivers().find((t) => t.sender === sender);
    await tuneScreenShare(track, sender, transceiver, this.#quality);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (offer.sdp === undefined) {
      this.emit('error', { message: 'Could not start the connection' });
      return;
    }
    signaling.send({ type: 'rtc.offer', to: participantId, sdp: offer.sdp });

    this.#startStats();
  }

  #closePeer(participantId: string): void {
    const peer = this.#peers.get(participantId);
    if (peer === undefined) return;
    peer.pc.close();
    this.#peers.delete(participantId);
  }

  #startStats(intervalMs = 2000): void {
    if (this.#statsTimer !== undefined) return;
    this.#statsTimer = setInterval(() => {
      const [first] = this.#peers.values();
      if (first === undefined) return;

      void readConnectionSnapshot(first.pc).then((snapshot) => {
        this.emit('stats', snapshot);
        // Reported so Phase 2 can answer the question that predicts TURN
        // cost: what fraction of connections go direct rather than relayed.
        this.#signaling?.send({
          type: 'stats.report',
          quality: qualityFrom(snapshot),
          connectionState: userFacingState(first.pc.connectionState),
          transport: snapshot.transport,
          ...(snapshot.roundTripMs === undefined ? {} : { roundTripMs: snapshot.roundTripMs }),
          ...(snapshot.resolution === undefined ? {} : { resolution: snapshot.resolution }),
          ...(snapshot.codec === undefined ? {} : { codec: snapshot.codec }),
          ...(snapshot.framesPerSecond === undefined
            ? {}
            : { framesPerSecond: snapshot.framesPerSecond }),
        });
        console.debug('[sharer]', formatSnapshot(snapshot));
      });
    }, intervalMs);
  }
}
