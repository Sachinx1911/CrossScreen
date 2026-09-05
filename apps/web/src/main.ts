import {
  IceCandidateQueue,
  SignalingClient,
  formatSnapshot,
  hasTurnServer,
  readConnectionSnapshot,
} from '@crossscreen/webrtc-core';

import { config, forceRelay, iceServers } from './config.ts';
import { mustFind } from './dom.ts';

/**
 * Phase 0.5 viewer.
 *
 * Deliberately the smallest thing that can prove the media path: connect,
 * answer the offer, render the track, and report which candidate pair won.
 * No routing, no session codes, no error recovery — those arrive in Phase 1.
 */

const video = mustFind<HTMLVideoElement>('#remote');
const hint = mustFind<HTMLParagraphElement>('#hint');
const statusEl = mustFind<HTMLSpanElement>('#status');
const dot = mustFind<HTMLSpanElement>('#dot');
const statsEl = mustFind<HTMLElement>('#stats');

function setStatus(text: string, tone: 'idle' | 'live' | 'bad' = 'idle'): void {
  statusEl.textContent = text;
  dot.className = `dot${tone === 'idle' ? '' : ` ${tone}`}`;
  // Logged as well as shown: a scripted run has no eyes on the window.
  console.info(`[viewer] ${text}`);
}

let peerId: string | undefined;
let pc: RTCPeerConnection | undefined;
let statsTimer: number | undefined;
// Created up front, not with the peer connection: candidates can arrive
// before the offer that creates it.
const iceQueue = new IceCandidateQueue();

/**
 * Let go of the current peer connection and its stats timer.
 *
 * A second offer is ordinary: it means the sharer restarted, which is exactly
 * what exit criterion 4 asks for when it says to re-run with the relay forced.
 * Replacing `pc` without closing the old one leaves it alive, and a dead
 * connection is not quiet — its `onconnectionstatechange` fires `failed` and
 * writes that into the same status element the new connection is using, so a
 * working reconnection reports "Connection failed". Its stats interval keeps
 * running too, so the line the gate is read off gets printed twice per tick,
 * once with numbers from a connection that no longer exists.
 *
 * The handlers are detached before closing, because closing is itself a state
 * change and would otherwise deliver one last message from the old connection.
 */
function discardPeerConnection(): void {
  if (pc !== undefined) {
    pc.onconnectionstatechange = null;
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.close();
    pc = undefined;
  }
  if (statsTimer !== undefined) {
    clearInterval(statsTimer);
    statsTimer = undefined;
  }
}

function createPeerConnection(signaling: SignalingClient, remoteId: string): RTCPeerConnection {
  const connection = new RTCPeerConnection({
    iceServers: iceServers(),
    ...(forceRelay() ? { iceTransportPolicy: 'relay' as const } : {}),
  });

  connection.ontrack = (event) => {
    const [stream] = event.streams;
    if (stream === undefined) return;
    video.srcObject = stream;
    hint.hidden = true;
    setStatus('Connected', 'live');
  };

  connection.onicecandidate = (event) => {
    if (event.candidate === null) return;
    signaling.send({
      type: 'rtc.ice',
      to: remoteId,
      candidate: event.candidate.candidate,
      sdpMid: event.candidate.sdpMid,
      sdpMLineIndex: event.candidate.sdpMLineIndex,
    });
  };

  connection.onconnectionstatechange = () => {
    const state = connection.connectionState;
    if (state === 'connected') setStatus('Connected', 'live');
    else if (state === 'failed') setStatus('Connection failed', 'bad');
    else if (state === 'disconnected') setStatus('Connection unstable', 'bad');
    else setStatus('Connecting…');
  };

  return connection;
}

async function start(): Promise<void> {
  // ?relay=1 with no TURN server gathers no candidates at all and then fails
  // without saying anything. See hasTurnServer.
  if (forceRelay() && !hasTurnServer(iceServers())) {
    setStatus('Relay forced, but no TURN server is configured', 'bad');
    hint.textContent =
      'Add TURN credentials with `pnpm turn`, or drop ?relay=1 from the URL. ' +
      'Forcing the relay without one discards every candidate and the connection ' +
      'fails silently — see docs/dev-setup.md.';
    return;
  }

  setStatus(forceRelay() ? 'Connecting (relay forced)…' : 'Connecting…');

  const signaling = new SignalingClient(config.signalingUrl);
  try {
    await signaling.connect();
  } catch {
    setStatus('Cannot reach CrossScreen', 'bad');
    hint.textContent = `Signaling server unreachable at ${config.signalingUrl}`;
    return;
  }

  signaling.on('session.state', (message) => {
    peerId = message.you;
    const other = message.session.participants.find((p) => p.participantId !== peerId);
    if (other === undefined) {
      hint.textContent = 'Connected. Waiting for someone to start sharing…';
    }
  });

  signaling.on('rtc.offer', async (message) => {
    // Whatever came before is finished with; see discardPeerConnection.
    discardPeerConnection();
    pc = createPeerConnection(signaling, message.from);
    iceQueue.attach(pc);
    await pc.setRemoteDescription({ type: 'offer', sdp: message.sdp });
    // Anything that arrived ahead of the offer is usable now.
    await iceQueue.flush();

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    if (answer.sdp === undefined) {
      setStatus('Could not start the connection', 'bad');
      return;
    }
    signaling.send({ type: 'rtc.answer', to: message.from, sdp: answer.sdp });

    pollStats();
  });

  signaling.on('rtc.ice', async (message) => {
    // The offer may not have arrived yet, in which case this is held rather
    // than thrown away — see IceCandidateQueue.
    await iceQueue.add({
      candidate: message.candidate,
      sdpMid: message.sdpMid,
      sdpMLineIndex: message.sdpMLineIndex,
    });
  });

  signaling.on('peer.left', () => {
    // Before setting the status, or the closing connection overwrites it.
    discardPeerConnection();
    setStatus('The host left', 'bad');
    hint.hidden = false;
    hint.textContent = 'The host ended the session.';
    video.srcObject = null;
  });

  signaling.on('error', (message) => {
    setStatus(message.userMessage, 'bad');
  });
}

function pollStats(): void {
  // One timer, however many offers arrive — the same guard the sharer uses.
  if (statsTimer !== undefined) return;
  statsTimer = window.setInterval(async () => {
    if (pc === undefined) return;
    const snapshot = await readConnectionSnapshot(pc);
    statsEl.textContent = formatSnapshot(snapshot);
    // The Phase 0.5 gate is read off this line: transport, path and codec.
    console.info('[viewer]', formatSnapshot(snapshot));
  }, config.statsIntervalMs);
}

void start();
