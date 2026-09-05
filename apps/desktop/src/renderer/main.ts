import {
  SignalingClient,
  formatSnapshot,
  readConnectionSnapshot,
  tuneScreenShare,
} from '@crossscreen/webrtc-core';

import { STATS_INTERVAL_MS, autoStart, forceRelay, iceServers, signalingUrl } from './config.ts';

/**
 * Phase 0.5 sharer.
 *
 * Capture a screen, offer it to whoever else is in the room, and report which
 * candidate pair won. Everything a real product needs — session codes, host
 * approval, source selection, error recovery — belongs to Phase 1 and is
 * deliberately absent here.
 */

const shareButton = document.querySelector<HTMLButtonElement>('#share')!;
const stopButton = document.querySelector<HTMLButtonElement>('#stop')!;
const preview = document.querySelector<HTMLVideoElement>('#preview')!;
const statusEl = document.querySelector<HTMLSpanElement>('#status')!;
const dot = document.querySelector<HTMLSpanElement>('#dot')!;
const statsEl = document.querySelector<HTMLPreElement>('#stats')!;

function setStatus(text: string, tone: 'idle' | 'live' | 'bad' = 'idle'): void {
  statusEl.textContent = text;
  dot.className = `dot${tone === 'idle' ? '' : ` ${tone}`}`;
  // Logged as well as shown: a scripted run has no eyes on the window.
  console.info('[%s] %s', 'sharer', text);
}

let signaling: SignalingClient | undefined;
let pc: RTCPeerConnection | undefined;
let stream: MediaStream | undefined;
let statsTimer: number | undefined;
let selfId: string | undefined;
let viewerId: string | undefined;

async function startSharing(): Promise<void> {
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
    void stopSharing();
  });

  setStatus('Connecting to signaling…');
  signaling = new SignalingClient(signalingUrl());

  try {
    await signaling.connect();
  } catch {
    setStatus('Cannot reach CrossScreen', 'bad');
    statsEl.textContent = `Signaling unreachable at ${signalingUrl()}`;
    await stopSharing();
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
  });

  signaling.on('rtc.ice', async (message) => {
    if (pc === undefined) return;
    try {
      await pc.addIceCandidate({
        candidate: message.candidate,
        sdpMid: message.sdpMid,
        sdpMLineIndex: message.sdpMLineIndex,
      });
    } catch (err) {
      console.warn('[sharer] rejected ICE candidate', err);
    }
  });

  signaling.on('peer.left', () => {
    setStatus('The viewer left. Waiting…');
    statsEl.textContent = 'no connection';
  });

  signaling.on('error', (message) => setStatus(message.userMessage, 'bad'));

  stopButton.disabled = false;
}

async function offerTo(remoteId: string): Promise<void> {
  if (stream === undefined || signaling === undefined) return;
  viewerId = remoteId;
  setStatus('Negotiating…');

  pc = new RTCPeerConnection({
    iceServers: iceServers(),
    ...(forceRelay() ? { iceTransportPolicy: 'relay' as const } : {}),
  });

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

  const track = stream.getVideoTracks()[0]!;
  const sender = pc.addTrack(track, stream);
  const transceiver = pc.getTransceivers().find((t) => t.sender === sender);

  // Screen content, not camera video: hold resolution and let frame rate give.
  await tuneScreenShare(track, sender, transceiver);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  signaling.send({ type: 'rtc.offer', to: remoteId, sdp: offer.sdp! });

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

async function stopSharing(): Promise<void> {
  if (statsTimer !== undefined) {
    clearInterval(statsTimer);
    statsTimer = undefined;
  }
  stream?.getTracks().forEach((t) => t.stop());
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

shareButton.addEventListener('click', () => void startSharing());
stopButton.addEventListener('click', () => void stopSharing());

if (autoStart()) void startSharing();
