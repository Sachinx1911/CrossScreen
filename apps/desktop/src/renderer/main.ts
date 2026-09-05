import {
  IceCandidateQueue,
  SignalingClient,
  formatSnapshot,
  hasTurnServer,
  readConnectionSnapshot,
  tuneScreenShare,
} from '@crossscreen/webrtc-core';

import { STATS_INTERVAL_MS, autoStart, forceRelay, iceServers, signalingUrl } from './config.ts';
import { mustFind } from './dom.ts';

/**
 * Phase 0.5 sharer.
 *
 * Capture a screen, offer it to whoever else is in the room, and report which
 * candidate pair won. Everything a real product needs — session codes, host
 * approval, source selection, error recovery — belongs to Phase 1 and is
 * deliberately absent here.
 */

const shareButton = mustFind<HTMLButtonElement>('#share');
const stopButton = mustFind<HTMLButtonElement>('#stop');
const preview = mustFind<HTMLVideoElement>('#preview');
const statusEl = mustFind<HTMLSpanElement>('#status');
const dot = mustFind<HTMLSpanElement>('#dot');
const statsEl = mustFind<HTMLPreElement>('#stats');

function setStatus(text: string, tone: 'idle' | 'live' | 'bad' = 'idle'): void {
  statusEl.textContent = text;
  dot.className = `dot${tone === 'idle' ? '' : ` ${tone}`}`;
  // Logged as well as shown: a scripted run has no eyes on the window.
  console.info(`[sharer] ${text}`);
}

let signaling: SignalingClient | undefined;
let pc: RTCPeerConnection | undefined;
let stream: MediaStream | undefined;
let statsTimer: number | undefined;
// Created up front, not with the peer connection: candidates can arrive
// before there is anything to attach them to.
const iceQueue = new IceCandidateQueue();
let selfId: string | undefined;
let viewerId: string | undefined;

async function startSharing(): Promise<void> {
  // Checked before the capture prompt, not after: asking for the screen and
  // then failing to connect for a reason known up front wastes the one
  // interaction the user has to grant. See hasTurnServer.
  if (forceRelay() && !hasTurnServer(iceServers())) {
    setStatus('Relay forced, but no TURN server is configured', 'bad');
    statsEl.textContent =
      'VITE_FORCE_RELAY=1 is set with no TURN credentials. Run `pnpm turn`, or unset it.\n' +
      'Forcing the relay without one discards every candidate and the connection fails\n' +
      'silently — see docs/dev-setup.md.';
    return;
  }

  shareButton.disabled = true;
  setStatus('Requesting screen…');

  try {
    // Chromium routes this to the platform's native capture backend via the
    // handler installed in the main process. See src/main/main.ts.
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch (err) {
    setStatus('Screen capture was refused', 'bad');
    statsEl.textContent = String(err);
    shareButton.disabled = false;
    return;
  }

  preview.srcObject = stream;

  // The OS can end a capture without asking us: the user clicks a system stop
  // control, or on Android later, the screen locks. Treat the track ending as
  // authoritative rather than assuming we are still sharing.
  stream.getVideoTracks()[0]?.addEventListener('ended', () => {
    setStatus('Your device stopped the screen share', 'bad');
    stopSharing();
  });

  setStatus('Connecting to signaling…');
  signaling = new SignalingClient(signalingUrl());

  try {
    await signaling.connect();
  } catch {
    setStatus('Cannot reach CrossScreen', 'bad');
    statsEl.textContent = `Signaling unreachable at ${signalingUrl()}`;
    stopSharing();
    return;
  }

  signaling.on('session.state', (message) => {
    selfId = message.you;
    const other = message.session.participants.find((p) => p.participantId !== selfId);
    if (other !== undefined) void offerTo(other.participantId);
    else setStatus('Waiting for a viewer…');
  });

  signaling.on('peer.joined', (message) => {
    void offerTo(message.participant.participantId);
  });

  signaling.on('rtc.answer', async (message) => {
    if (pc === undefined) return;
    await pc.setRemoteDescription({ type: 'answer', sdp: message.sdp });
    // Candidates that arrived while we were waiting for this are now usable.
    await iceQueue.flush();
  });

  signaling.on('rtc.ice', async (message) => {
    await iceQueue.add({
      candidate: message.candidate,
      sdpMid: message.sdpMid,
      sdpMLineIndex: message.sdpMLineIndex,
    });
  });

  signaling.on('peer.left', () => {
    setStatus('The viewer left. Waiting…');
    statsEl.textContent = 'no connection';
  });

  signaling.on('error', (message) => {
    setStatus(message.userMessage, 'bad');
  });

  stopButton.disabled = false;
}

async function offerTo(remoteId: string): Promise<void> {
  if (stream === undefined || signaling === undefined) return;

  // A viewer that reloads leaves and rejoins under a new peer id, so this runs
  // again for the same screen. The previous connection has nobody on the other
  // end, but it is not inert: it holds its ICE state open — a relay allocation
  // once TURN is configured — and its statechange handler still writes 'failed'
  // over the status of the connection that replaced it.
  if (pc !== undefined) {
    pc.onconnectionstatechange = null;
    pc.onicecandidate = null;
    pc.close();
  }

  viewerId = remoteId;
  setStatus('Negotiating…');

  pc = new RTCPeerConnection({
    iceServers: iceServers(),
    ...(forceRelay() ? { iceTransportPolicy: 'relay' as const } : {}),
  });

  iceQueue.attach(pc);

  pc.onicecandidate = (event) => {
    if (event.candidate === null || viewerId === undefined) return;
    signaling?.send({
      type: 'rtc.ice',
      to: viewerId,
      candidate: event.candidate.candidate,
      sdpMid: event.candidate.sdpMid,
      sdpMLineIndex: event.candidate.sdpMLineIndex,
    });
  };

  pc.onconnectionstatechange = () => {
    const state = pc?.connectionState;
    if (state === 'connected') setStatus('Sharing — connected', 'live');
    else if (state === 'failed') setStatus('Connection failed', 'bad');
    else if (state === 'disconnected') setStatus('Connection unstable', 'bad');
  };

  const track = stream.getVideoTracks()[0];
  if (track === undefined) {
    setStatus('The screen capture ended before it could be shared', 'bad');
    return;
  }
  const sender = pc.addTrack(track, stream);
  const transceiver = pc.getTransceivers().find((t) => t.sender === sender);

  // Screen content, not camera video: hold resolution and let frame rate give.
  await tuneScreenShare(track, sender, transceiver);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  if (offer.sdp === undefined) {
    setStatus('Could not start the connection', 'bad');
    return;
  }
  signaling.send({ type: 'rtc.offer', to: remoteId, sdp: offer.sdp });

  startStatsPolling();
}

function startStatsPolling(): void {
  if (statsTimer !== undefined) return;
  statsTimer = window.setInterval(async () => {
    if (pc === undefined) return;
    const snapshot = await readConnectionSnapshot(pc);
    const line = formatSnapshot(snapshot);
    statsEl.textContent = line;
    // The Phase 0.5 gate is read off this line.
    console.info('[sharer]', line);
  }, STATS_INTERVAL_MS);
}

function stopSharing(): void {
  if (statsTimer !== undefined) {
    clearInterval(statsTimer);
    statsTimer = undefined;
  }
  stream?.getTracks().forEach((t) => {
    t.stop();
  });
  stream = undefined;
  preview.srcObject = null;
  pc?.close();
  pc = undefined;
  signaling?.close();
  signaling = undefined;
  viewerId = undefined;

  shareButton.disabled = false;
  stopButton.disabled = true;
  if (!dot.className.includes('bad')) setStatus('Idle');
}

shareButton.addEventListener('click', () => {
  void startSharing();
});
stopButton.addEventListener('click', () => {
  stopSharing();
});

if (autoStart()) void startSharing();
