import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { WebSocket } from 'ws';

import { envelope, type ServerEnvelope } from '@crossscreen/protocol';

/**
 * Integration tests against a real server process.
 *
 * The relay is the only thing the walking skeleton has to get right, so it is
 * worth testing properly even though the room itself is throwaway: if the
 * server forges, drops or misroutes a negotiation message, the media path will
 * fail in a way that looks like a WebRTC problem and costs hours to find.
 */

const PORT = 8791;

before(async () => {
  // Configure before importing: the server reads its config at module load.
  process.env['SIGNALING_PORT'] = String(PORT);
  process.env['LOG_LEVEL'] = 'error';
  await import('./server.ts');
  await new Promise((r) => setTimeout(r, 300));
});

/**
 * A client that buffers every frame from the moment the socket is created.
 *
 * The server sends `session.state` the instant a peer connects, so attaching a
 * listener after awaiting 'open' races with it and loses the frame. Buffering
 * from construction removes the race entirely.
 */
class Client {
  readonly ws: WebSocket;
  readonly #received: ServerEnvelope[] = [];
  readonly #waiters: { type: string; resolve: (e: ServerEnvelope) => void }[] = [];

  constructor() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    this.ws.on('message', (data: Buffer) => {
      const env = JSON.parse(data.toString()) as ServerEnvelope;
      const index = this.#waiters.findIndex((w) => w.type === env.payload.type);
      if (index >= 0) {
        const [waiter] = this.#waiters.splice(index, 1);
        waiter!.resolve(env);
        return;
      }
      this.#received.push(env);
    });
  }

  static async open(): Promise<Client> {
    const client = new Client();
    await new Promise<void>((resolve, reject) => {
      client.ws.once('open', () => resolve());
      client.ws.once('error', reject);
    });
    return client;
  }

  /** Resolves from the buffer if the frame already arrived, else waits for it. */
  next(type: string, timeoutMs = 2000): Promise<ServerEnvelope> {
    const index = this.#received.findIndex((e) => e.payload.type === type);
    if (index >= 0) return Promise.resolve(this.#received.splice(index, 1)[0]!);

    return new Promise((resolve, reject) => {
      const waiter = { type, resolve };
      this.#waiters.push(waiter);
      setTimeout(() => {
        const i = this.#waiters.indexOf(waiter);
        if (i >= 0) {
          this.#waiters.splice(i, 1);
          reject(new Error(`timed out waiting for ${type}`));
        }
      }, timeoutMs);
    });
  }

  send(message: Parameters<typeof envelope>[0]): void {
    this.ws.send(JSON.stringify(envelope(message)));
  }

  close(): void {
    this.ws.close();
  }
}

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 120));
}

test('the first peer is the host and the second is the viewer', async () => {
  const host = await Client.open();
  const hostState = await host.next('session.state');
  assert.equal(hostState.payload.type, 'session.state');
  if (hostState.payload.type !== 'session.state') assert.fail('no state');

  const hostId = hostState.payload.you;
  const me = hostState.payload.session.participants.find((p) => p.participantId === hostId);
  assert.equal(me?.role, 'host');

  const viewer = await Client.open();
  const viewerState = await viewer.next('session.state');
  if (viewerState.payload.type !== 'session.state') assert.fail('no state');
  const them = viewerState.payload.session.participants.find(
    (p) => p.participantId === viewerState.payload.you,
  );
  assert.equal(them?.role, 'viewer');

  // The host is told about the arrival rather than having to poll for it.
  const joined = await host.next('peer.joined');
  assert.equal(joined.payload.type, 'peer.joined');

  host.close();
  viewer.close();
  await settle();
});

test('an offer reaches the other peer with a server-asserted sender', async () => {
  const host = await Client.open();
  const hostState = await host.next('session.state');
  if (hostState.payload.type !== 'session.state') assert.fail('no state');
  const hostId = hostState.payload.you;

  const viewer = await Client.open();
  await viewer.next('session.state');

  const sdp = ['v=0', 'o=- 0 0 IN IP4 127.0.0.1', 's=-', ''].join('\r\n');
  host.send({
    type: 'rtc.offer',
    // A deliberately wrong target: the server must not trust it.
    to: '00000000-0000-4000-8000-000000000000',
    sdp,
  });

  const received = await viewer.next('rtc.offer');
  assert.equal(received.payload.type, 'rtc.offer');
  if (received.payload.type !== 'rtc.offer') assert.fail('wrong type');
  assert.equal(received.payload.from, hostId, 'sender must be asserted by the server');
  assert.equal(received.payload.sdp, sdp, 'SDP must be relayed byte for byte');
  assert.ok(!('to' in received.payload), 'the client-supplied target must not be echoed back');

  host.close();
  viewer.close();
  await settle();
});

test('ICE candidates are relayed intact', async () => {
  const host = await Client.open();
  await host.next('session.state');
  const viewer = await Client.open();
  await viewer.next('session.state');

  const candidate = 'candidate:1 1 udp 2130706431 192.168.1.5 54321 typ host';
  host.send({
    type: 'rtc.ice',
    to: '00000000-0000-4000-8000-000000000000',
    candidate,
    sdpMid: '0',
    sdpMLineIndex: 0,
  });

  const received = await viewer.next('rtc.ice');
  if (received.payload.type !== 'rtc.ice') assert.fail('wrong type');
  assert.equal(received.payload.candidate, candidate);
  assert.equal(received.payload.sdpMid, '0');
  assert.equal(received.payload.sdpMLineIndex, 0);

  host.close();
  viewer.close();
  await settle();
});

test('a third peer is refused rather than silently joining', async () => {
  const host = await Client.open();
  await host.next('session.state');
  const viewer = await Client.open();
  await viewer.next('session.state');

  const third = new WebSocket(`ws://127.0.0.1:${PORT}`);
  const closeCode = await new Promise<number>((resolve) => {
    third.once('close', (code) => resolve(code));
  });
  assert.equal(closeCode, 1013);

  host.close();
  viewer.close();
  await settle();
});

test('a malformed frame is answered with an error, not a disconnect', async () => {
  const host = await Client.open();
  await host.next('session.state');

  host.ws.send('{not json');
  const err = await host.next('error');
  if (err.payload.type !== 'error') assert.fail('wrong type');
  assert.equal(err.payload.code, 'MALFORMED_MESSAGE');
  assert.ok(err.payload.userMessage.length > 0);
  assert.equal(host.ws.readyState, WebSocket.OPEN, 'the socket should stay open');

  host.close();
  await settle();
});

test('relaying with no peer present reports a missing session', async () => {
  const lonely = await Client.open();
  await lonely.next('session.state');

  lonely.send({
    type: 'rtc.ice',
    to: '00000000-0000-4000-8000-000000000000',
    candidate: 'candidate:1 1 udp 1 127.0.0.1 1 typ host',
    sdpMid: '0',
    sdpMLineIndex: 0,
  });

  const err = await lonely.next('error');
  if (err.payload.type !== 'error') assert.fail('wrong type');
  assert.equal(err.payload.code, 'SESSION_NOT_FOUND');

  lonely.close();
  await settle();
});

test('a peer leaving notifies the one that remains', async () => {
  const host = await Client.open();
  const hostState = await host.next('session.state');
  if (hostState.payload.type !== 'session.state') assert.fail('no state');

  const viewer = await Client.open();
  const viewerState = await viewer.next('session.state');
  if (viewerState.payload.type !== 'session.state') assert.fail('no state');
  const viewerId = viewerState.payload.you;
  await host.next('peer.joined');

  viewer.close();
  const left = await host.next('peer.left');
  if (left.payload.type !== 'peer.left') assert.fail('wrong type');
  assert.equal(left.payload.participantId, viewerId);

  host.close();
  await settle();
});

test('a sharer that restarts is the host again, not a second viewer', async () => {
  const host = await Client.open();
  await host.next('session.state');

  const viewer = await Client.open();
  await viewer.next('session.state');
  await host.next('peer.joined');

  // The sharer restarts — which exit criterion 4 asks for by name, since the
  // forced-relay run means relaunching it with VITE_FORCE_RELAY=1 while the
  // viewer stays open. The viewer is now the only peer in the room.
  host.close();
  await viewer.next('peer.left');
  await settle();

  const restarted = await Client.open();
  const state = await restarted.next('session.state');
  if (state.payload.type !== 'session.state') assert.fail('no state');

  const me = state.payload.session.participants.find((p) => p.participantId === state.payload.you);
  assert.equal(me?.role, 'host', 'the returning sharer should hold the vacant host slot');

  const roles = state.payload.session.participants.map((p) => p.role).sort();
  assert.deepEqual(roles, ['host', 'viewer'], 'the room should not end up with two viewers');

  restarted.close();
  viewer.close();
  await settle();
});

after(() => {
  // The server holds the event loop open; nothing else needs tearing down.
  setTimeout(() => process.exit(0), 200);
});
