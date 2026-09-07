import type { ConnectionState } from '@crossscreen/protocol';

import type { ApiClient } from './api-client.ts';
import { Emitter } from './events.ts';
import { IceCandidateQueue } from './ice-queue.ts';
import { FORCE_RELAY_REQUIRES_TURN, hasTurnServer } from './relay.ts';
import { qualityFrom, userFacingState } from './sharer-session.ts';
import { SignalingClient } from './signaling-client.ts';
import { formatSnapshot, readConnectionSnapshot, type ConnectionSnapshot } from './stats.ts';

/**
 * Watching someone else's screen.
 *
 * The mirror of `SharerSession`, and deliberately the simpler half: a viewer
 * asks, waits, and answers whatever offer arrives. It never initiates, because
 * it is never the side that has been trusted.
 *
 * The wait is the part that needs care. Between asking and being allowed there
 * is a human decision happening somewhere else, and a screen that says nothing
 * while it happens looks broken.
 */

export type ViewerPhase =
  'connecting' | 'waiting-for-host' | 'approved' | 'watching' | 'rejected' | 'ended' | 'failed';

export interface ViewerEvents {
  phase: { phase: ViewerPhase; message?: string };
  stream: MediaStream;
  connection: { state: ConnectionState };
  stats: ConnectionSnapshot;
  error: { message: string };
}

export interface ViewerDependencies {
  api: ApiClient;
  signalingUrl: string;
  /** One or the other. A link carries a token; a person types a code. */
  joinCode?: string;
  joinToken?: string;
  /** Pins ICE to relay, to prove the TURN path independently of P2P. */
  forceRelay?: boolean;
}

export class ViewerSession extends Emitter<ViewerEvents> {
  readonly #deps: ViewerDependencies;
  #signaling: SignalingClient | undefined;
  #pc: RTCPeerConnection | undefined;
  #ice: IceCandidateQueue | undefined;
  #statsTimer: ReturnType<typeof setInterval> | undefined;
  #iceServers: RTCIceServer[] = [];
  #stopped = false;
  /**
   * Set once approved. Carried into the join request sent after a signaling
   * reconnect, so this viewer resumes its own slot instead of re-entering the
   * pending queue and waiting on the host a second time (§2.3).
   */
  #resume: { participantId: string; participantToken: string } | undefined;

  constructor(deps: ViewerDependencies) {
    super();
    this.#deps = deps;
  }

  /**
   * Starting is asynchronous, and whoever started it can give up part way
   * through — a navigation, a closed tab, React remounting an effect. Each
   * await is therefore followed by a check, because without one a session that
   * was already stopped goes on to open a socket and ask to join, leaving the
   * host looking at a request from someone who is no longer there.
   */
  async start(): Promise<void> {
    this.emit('phase', { phase: 'connecting' });

    try {
      this.#iceServers = await this.#deps.api.iceServers();
    } catch {
      // Not fatal on its own. STUN alone still works on friendly networks, and
      // refusing here would abandon a session that might have connected.
      this.#iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    }

    if (this.#stopped) return;

    // `iceTransportPolicy: 'relay'` discards every non-relay candidate. With
    // no TURN server there is nothing left to gather, and ICE completes
    // having found no path at all — indistinguishable from the genuine
    // no-path failure this mode exists to investigate. Caught here instead.
    if (this.#deps.forceRelay === true && !hasTurnServer(this.#iceServers)) {
      this.emit('phase', { phase: 'failed', message: FORCE_RELAY_REQUIRES_TURN });
      return;
    }

    const signaling = new SignalingClient(this.#deps.signalingUrl);
    this.#signaling = signaling;
    this.#wire(signaling);

    try {
      await signaling.connect();
    } catch {
      this.emit('phase', {
        phase: 'failed',
        message: 'CrossScreen is unreachable. Check your connection.',
      });
      return;
    }

    if (this.#stopped) {
      signaling.close();
      return;
    }

    this.#requestJoin(signaling);
    globalThis.addEventListener?.('pagehide', this.#onPageHide);
  }

  /**
   * The join request, with a resume attached if this viewer was previously
   * approved. Used both for the first attempt and, via `onReconnect`, for
   * every one after — a signaling drop that happened before approval simply
   * re-requests and waits again, which is the honest state to be in, since
   * the server removed that pending request the moment the socket dropped.
   */
  #requestJoin(signaling: SignalingClient): void {
    signaling.send({
      type: 'session.viewer.request',
      ...(this.#deps.joinToken !== undefined
        ? { joinToken: this.#deps.joinToken }
        : { joinCode: this.#deps.joinCode ?? '' }),
      ...(this.#resume === undefined ? {} : { resume: this.#resume }),
    });
  }

  /**
   * A page going away for good is a deliberate departure — as distinct from a
   * socket that merely dropped, which the server now holds for a grace period
   * instead of ending anything (§2.3). Without saying so, closing a tab would
   * look exactly like a lost Wi-Fi signal, and the host would go on seeing
   * "watching" until the grace period ran out on its own.
   *
   * `pagehide` rather than `beforeunload`: mobile browsers frequently skip the
   * latter. `persisted` means the page went into the back/forward cache and
   * may yet come back, which is a pause, not an ending.
   */
  readonly #onPageHide = (event: Event): void => {
    if ((event as PageTransitionEvent).persisted) return;
    this.#signaling?.send({ type: 'session.viewer.leave' });
  };

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;

    if (this.#statsTimer !== undefined) clearInterval(this.#statsTimer);
    this.#statsTimer = undefined;
    globalThis.removeEventListener?.('pagehide', this.#onPageHide);
    this.#pc?.close();
    this.#pc = undefined;
    this.#signaling?.send({ type: 'session.viewer.leave' });
    this.#signaling?.close();
    this.#signaling = undefined;
  }

  #wire(signaling: SignalingClient): void {
    signaling.on('session.state', (message) => {
      // A resumed viewer's own record already reads 'connected' — the server
      // rebound it without ever un-approving it — so this is not a fresh
      // arrival waiting on a decision, and must not be shown as one. Anyone
      // still pending genuinely is, and that is the only case left to report.
      const self = message.session.participants.find((p) => p.participantId === message.you);
      if (self?.state !== 'connected') {
        this.emit('phase', { phase: 'waiting-for-host' });
      }
    });

    signaling.on('session.viewer.approved', (message) => {
      // Kept so a later reconnect can present the same identity instead of
      // re-entering the pending queue and waiting on the host a second time.
      this.#resume = {
        participantId: message.participantId,
        participantToken: message.participantToken,
      };
      this.emit('phase', { phase: 'approved' });
    });

    signaling.on('session.viewer.rejected', () => {
      this.emit('phase', {
        phase: 'rejected',
        message: 'The host declined your request to join.',
      });
      this.stop();
    });

    // An offer only ever arrives after approval — the server will not relay
    // one before it (ADR-0006). Answering whatever turns up is therefore safe.
    signaling.on('rtc.offer', async (message) => {
      await this.#answer(message.sdp, message.from);
    });

    signaling.on('rtc.ice', async (message) => {
      await this.#ice?.add({
        candidate: message.candidate,
        sdpMid: message.sdpMid,
        sdpMLineIndex: message.sdpMLineIndex,
      });
    });

    signaling.on('session.ended', (message) => {
      const reasons = {
        host_ended: 'The host ended the session.',
        expired: 'This session has expired.',
        idle_timeout: 'The session ended because nobody was watching.',
      } as const;
      this.emit('phase', { phase: 'ended', message: reasons[message.reason] });
      this.stop();
    });

    // The picture keeps moving while signaling is away — media is
    // peer-to-peer and never touched that socket. Say "reconnecting" and let
    // the client retry rather than ending a session that is still playing.
    signaling.onState((state) => {
      if (state === 'reconnecting') {
        this.emit('connection', { state: 'reconnecting' });
        return;
      }
      // Reverts it. Without this, "Reconnecting…" was permanent once shown:
      // nothing else re-reads the peer connection's own state, which very
      // often has not changed at all during a signaling-only outage.
      if (state === 'open' && this.#pc !== undefined) {
        this.emit('connection', { state: userFacingState(this.#pc.connectionState) });
      }
    });

    // Fires only for a genuine reconnect, never the first connection — see
    // SignalingClient.onReconnect. Resending with whatever #resume holds is
    // what lets an approved viewer keep its slot instead of asking again.
    signaling.onReconnect(() => {
      this.#requestJoin(signaling);
    });

    signaling.onClose(() => {
      // Only once retrying has been given up on, by which point the server has
      // swept the session this viewer was watching.
      this.emit('phase', {
        phase: 'ended',
        message: 'The connection to CrossScreen was lost.',
      });
      this.stop();
    });

    signaling.on('error', (message) => {
      this.emit('error', { message: message.userMessage });
      // A join that cannot proceed is a dead end. Leaving the viewer on a
      // spinner while the reason sits somewhere else is worse than saying so.
      if (!message.retryable) {
        this.emit('phase', { phase: 'failed', message: message.userMessage });
      }
    });
  }

  async #answer(sdp: string, from: string): Promise<void> {
    const signaling = this.#signaling;
    if (signaling === undefined) return;

    const pc = new RTCPeerConnection({
      iceServers: this.#iceServers,
      ...(this.#deps.forceRelay === true ? { iceTransportPolicy: 'relay' as const } : {}),
    });
    this.#pc = pc;
    this.#ice = new IceCandidateQueue(pc);

    pc.ontrack = (event): void => {
      const [stream] = event.streams;
      if (stream === undefined) return;
      this.emit('stream', stream);
      this.emit('phase', { phase: 'watching' });
    };

    pc.onicecandidate = (event): void => {
      if (event.candidate === null) return;
      signaling.send({
        type: 'rtc.ice',
        to: from,
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
      });
    };

    pc.onconnectionstatechange = (): void => {
      this.emit('connection', { state: userFacingState(pc.connectionState) });
    };

    await pc.setRemoteDescription({ type: 'offer', sdp });
    // Anything that arrived ahead of the offer is usable now.
    await this.#ice.flush();

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    if (answer.sdp === undefined) {
      this.emit('error', { message: 'Could not join the session.' });
      return;
    }
    signaling.send({ type: 'rtc.answer', to: from, sdp: answer.sdp });

    this.#startStats();
  }

  #startStats(intervalMs = 2000): void {
    if (this.#statsTimer !== undefined) return;
    this.#statsTimer = setInterval(() => {
      const pc = this.#pc;
      if (pc === undefined) return;

      void readConnectionSnapshot(pc).then((snapshot) => {
        this.emit('stats', snapshot);
        this.#signaling?.send({
          type: 'stats.report',
          quality: qualityFrom(snapshot),
          connectionState: userFacingState(pc.connectionState),
          transport: snapshot.transport,
          ...(snapshot.roundTripMs === undefined ? {} : { roundTripMs: snapshot.roundTripMs }),
          ...(snapshot.resolution === undefined ? {} : { resolution: snapshot.resolution }),
          ...(snapshot.codec === undefined ? {} : { codec: snapshot.codec }),
        });
        console.debug('[viewer]', formatSnapshot(snapshot));
      });
    }, intervalMs);
  }
}
