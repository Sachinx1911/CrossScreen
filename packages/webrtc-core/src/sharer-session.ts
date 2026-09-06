import type { ConnectionState, JoinRequestInfo } from '@crossscreen/protocol';

import type { ApiClient, CreatedSession } from './api-client.ts';
import { Emitter } from './events.ts';
import { IceCandidateQueue } from './ice-queue.ts';
import { SignalingClient } from './signaling-client.ts';
import { formatSnapshot, readConnectionSnapshot, type ConnectionSnapshot } from './stats.ts';
import { tuneScreenShare } from './tuning.ts';

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
  /** Supplied rather than captured here: the shell owns the capture policy. */
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
    await tuneScreenShare(track, sender, transceiver);

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
