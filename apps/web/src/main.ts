import { SignalingClient, formatSnapshot, readConnectionSnapshot } from '@crossscreen/webrtc-core';

import { config, forceRelay, iceServers } from './config.ts';

/**
 * Phase 0.5 viewer.
 *
 * Deliberately the smallest thing that can prove the media path: connect,
 * answer the offer, render the track, and report which candidate pair won.
 * No routing, no session codes, no error recovery — those arrive in Phase 1.
 */

const video = document.querySelector<HTMLVideoElement>('#remote')!;
const hint = document.querySelector<HTMLParagraphElement>('#hint')!;
const statusEl = document.querySelector<HTMLSpanElement>('#status')!;
const dot = document.querySelector<HTMLSpanElement>('#dot')!;
const statsEl = document.querySelector<HTMLElement>('#stats')!;

function setStatus(text: string, tone: 'idle' | 'live' | 'bad' = 'idle'): void {
  statusEl.textContent = text;
  dot.className = `dot${tone === 'idle' ? '' : ` ${tone}`}`;
  // Logged as well as shown: a scripted run has no eyes on the window.
  console.info('[%s] %s', 'viewer', text);
}

let peerId: string | undefined;
let pc: RTCPeerConnection | undefined;

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
    pc = createPeerConnection(signaling, message.from);
    await pc.setRemoteDescription({ type: 'offer', sdp: message.sdp });

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    signaling.send({ type: 'rtc.answer', to: message.from, sdp: answer.sdp! });

    pollStats();
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
      console.warn('[viewer] rejected ICE candidate', err);
    }
  });

  signaling.on('peer.left', () => {
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
  setInterval(async () => {
    if (pc === undefined) return;
    const snapshot = await readConnectionSnapshot(pc);
    statsEl.textContent = formatSnapshot(snapshot);
    // The Phase 0.5 gate is read off this line: transport, path and codec.
    console.info('[viewer]', formatSnapshot(snapshot));
  }, config.statsIntervalMs);
}

void start();
