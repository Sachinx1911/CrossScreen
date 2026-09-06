import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { WebSocket } from 'ws';

import {
  createSessionIdentifiers,
  envelope,
  signHostToken,
  type ClientMessage,
  type HostTokenClaims,
  type ServerEnvelope,
} from '@crossscreen/protocol';

/**
 * The join flow, against a real server process.
 *
 * The test that matters most is the third one: a viewer the host has not
 * approved sends an offer, and the server refuses to carry it. Everything
 * ADR-0006 claims rests on that refusal actually happening over the wire, not
 * merely in the unit test of `mayRelay`.
 */

const PORT = 8793;
const SECRET = 'a-signaling-test-secret-long-enough-ok';

before(async () => {
  process.env['SIGNALING_PORT'] = String(PORT);
  process.env['SESSION_SECRET'] = SECRET;
  process.env['LOG_LEVEL'] = 'error';
  await import('./server.ts');
  await new Promise((r) => setTimeout(r, 300));
});

class Client {
  readonly ws: WebSocket;
  readonly #received: ServerEnvelope[] = [];
  readonly #waiters: { type: string; resolve: (e: ServerEnvelope) => void }[] = [];

  constructor() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    this.ws.on('message', (data: Buffer) => {
      const env = JSON.parse(data.toString()) as ServerEnvelope;
      const i = this.#waiters.findIndex((w) => w.type === env.payload.type);
      if (i >= 0) {
        this.#waiters.splice(i, 1)[0]!.resolve(env);
        return;
      }
      this.#received.push(env);
    });
  }

  static async open(): Promise<Client> {
    const c = new Client();
    await new Promise<void>((resolve, reject) => {
      c.ws.once('open', () => {
        resolve();
      });
      c.ws.once('error', reject);
    });
    return c;
  }

  next(type: string, timeoutMs = 2000): Promise<ServerEnvelope> {
    const i = this.#received.findIndex((e) => e.payload.type === type);
    if (i >= 0) return Promise.resolve(this.#received.splice(i, 1)[0]!);
    return new Promise((resolve, reject) => {
      const waiter = { type, resolve };
      this.#waiters.push(waiter);
      setTimeout(() => {
        const j = this.#waiters.indexOf(waiter);
        if (j >= 0) {
          this.#waiters.splice(j, 1);
          reject(new Error(`timed out waiting for ${type}`));
        }
      }, timeoutMs);
    });
  }

  /** Assert that a frame does NOT arrive within the window. */
  async never(type: string, windowMs = 600): Promise<void> {
    try {
      await this.next(type, windowMs);
      assert.fail(`received ${type}, which should not have been sent`);
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith('timed out')) throw err;
    }
  }

  send(message: ClientMessage): void {
    this.ws.send(JSON.stringify(envelope(message)));
  }

  close(): void {
    this.ws.close();
  }
}

const settle = () => new Promise((r) => setTimeout(r, 120));

async function newHostToken(): Promise<{ token: string; code: string; link: string }> {
  const ids = createSessionIdentifiers();
  const claims: HostTokenClaims = {
    sid: ids.sessionId,
    code: ids.joinCode,
    tok: ids.joinToken,
    iat: Math.floor(ids.createdAt / 1000),
    exp: Math.floor(ids.expiresAt / 1000),
  };
  return {
    token: await signHostToken(claims, SECRET),
    code: ids.joinCode,
    link: ids.joinToken,
  };
}

async function attachedHost() {
  const { token, code, link } = await newHostToken();
  const host = await Client.open();
  host.send({ type: 'session.host.attach', hostToken: token });
  const state = await host.next('session.state');
  if (state.payload.type !== 'session.state') assert.fail('no state');
  return { host, code, link, hostId: state.payload.you };
}

const SDP = ['v=0', 'o=- 0 0 IN IP4 127.0.0.1', 's=-', ''].join('\r\n');

test('a host attaches with a valid token and the session becomes joinable', async () => {
  const { host, code } = await attachedHost();

  const viewer = await Client.open();
  viewer.send({ type: 'session.viewer.request', joinCode: code });

  const pending = await host.next('session.viewer.pending');
  if (pending.payload.type !== 'session.viewer.pending') assert.fail('wrong type');
  assert.equal(pending.payload.request.joinedVia, 'code');
  assert.ok(pending.payload.request.deviceLabel.length > 0);

  host.close();
  viewer.close();
  await settle();
});

test('a token signed with another secret is refused', async () => {
  // Signed correctly, just not by us — the realistic forgery, and the one the
  // shared secret exists to stop.
  const ids = createSessionIdentifiers();
  const forged = await signHostToken(
    {
      sid: ids.sessionId,
      code: ids.joinCode,
      tok: ids.joinToken,
      iat: Math.floor(ids.createdAt / 1000),
      exp: Math.floor(ids.expiresAt / 1000),
    },
    'a-secret-we-do-not-share-with-anyone-x',
  );

  const host = await Client.open();
  host.send({ type: 'session.host.attach', hostToken: forged });

  const err = await host.next('error');
  if (err.payload.type !== 'error') assert.fail('wrong type');
  assert.equal(err.payload.code, 'INVALID_TOKEN');

  host.close();
  await settle();
});

test('altering the claims invalidates the token', async () => {
  // Rewriting `sid` would name someone else's session. Note that editing the
  // *last* character of the signature does not forge anything: 32 bytes encode
  // to 43 base64 characters, the final one carries only two significant bits,
  // and the rest are discarded on decode — so such a token still verifies.
  // The payload is where a forgery has to happen, and where it is caught.
  const { token } = await newHostToken();
  const [header, payload, signature] = token.split('.') as [string, string, string];

  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as HostTokenClaims;
  claims.sid = '00000000-0000-4000-8000-000000000000';
  const edited = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');

  const host = await Client.open();
  host.send({ type: 'session.host.attach', hostToken: `${header}.${edited}.${signature}` });

  const err = await host.next('error');
  if (err.payload.type !== 'error') assert.fail('wrong type');
  assert.equal(err.payload.code, 'INVALID_TOKEN');

  host.close();
  await settle();
});

test('an offer to a viewer the host has not approved is refused', async () => {
  // The claim ADR-0006 makes, tested over the wire rather than in a unit.
  const { host, code } = await attachedHost();

  const viewer = await Client.open();
  viewer.send({ type: 'session.viewer.request', joinCode: code });
  const pending = await host.next('session.viewer.pending');
  if (pending.payload.type !== 'session.viewer.pending') assert.fail('wrong type');
  const viewerId = pending.payload.request.participantId;

  host.send({ type: 'rtc.offer', to: viewerId, sdp: SDP });

  const err = await host.next('error');
  if (err.payload.type !== 'error') assert.fail('wrong type');
  assert.equal(err.payload.code, 'JOIN_REJECTED');
  await viewer.never('rtc.offer');

  host.close();
  viewer.close();
  await settle();
});

test('a pending viewer cannot push an offer at the host either', async () => {
  const { host, code, hostId } = await attachedHost();

  const viewer = await Client.open();
  viewer.send({ type: 'session.viewer.request', joinCode: code });
  await viewer.next('session.state');
  await host.next('session.viewer.pending');

  viewer.send({ type: 'rtc.offer', to: hostId, sdp: SDP });

  const err = await viewer.next('error');
  if (err.payload.type !== 'error') assert.fail('wrong type');
  assert.equal(err.payload.code, 'JOIN_REJECTED');
  await host.never('rtc.offer');

  host.close();
  viewer.close();
  await settle();
});

test('after approval the offer flows, with a server-asserted sender', async () => {
  const { host, code, hostId } = await attachedHost();

  const viewer = await Client.open();
  viewer.send({ type: 'session.viewer.request', joinCode: code });
  const pending = await host.next('session.viewer.pending');
  if (pending.payload.type !== 'session.viewer.pending') assert.fail('wrong type');
  const viewerId = pending.payload.request.participantId;

  host.send({ type: 'session.viewer.approve', participantId: viewerId });

  const approved = await viewer.next('session.viewer.approved');
  if (approved.payload.type !== 'session.viewer.approved') assert.fail('wrong type');
  assert.ok(approved.payload.participantToken.length > 0, 'approval issues the token');

  host.send({ type: 'rtc.offer', to: viewerId, sdp: SDP });
  const offer = await viewer.next('rtc.offer');
  if (offer.payload.type !== 'rtc.offer') assert.fail('wrong type');
  assert.equal(offer.payload.from, hostId, 'the sender is asserted by the server');
  assert.equal(offer.payload.sdp, SDP, 'SDP is relayed byte for byte');
  assert.ok(!('to' in offer.payload), 'the client-supplied target is not echoed back');

  host.close();
  viewer.close();
  await settle();
});

test('a viewer cannot approve itself', async () => {
  const { host, code } = await attachedHost();

  const viewer = await Client.open();
  viewer.send({ type: 'session.viewer.request', joinCode: code });
  await viewer.next('session.state');
  const pending = await host.next('session.viewer.pending');
  if (pending.payload.type !== 'session.viewer.pending') assert.fail('wrong type');

  viewer.send({
    type: 'session.viewer.approve',
    participantId: pending.payload.request.participantId,
  });

  const err = await viewer.next('error');
  if (err.payload.type !== 'error') assert.fail('wrong type');
  assert.equal(err.payload.code, 'NOT_SESSION_HOST');
  await viewer.never('session.viewer.approved');

  host.close();
  viewer.close();
  await settle();
});

test('a code with no live session answers the same as a guessed one', async () => {
  // Both must be SESSION_NOT_FOUND, so enumerating codes reveals nothing about
  // which sessions exist.
  const { code } = await newHostToken(); // a real code whose host never attached

  for (const joinCode of [code, '000000']) {
    const viewer = await Client.open();
    viewer.send({ type: 'session.viewer.request', joinCode });
    const err = await viewer.next('error');
    if (err.payload.type !== 'error') assert.fail('wrong type');
    assert.equal(err.payload.code, 'SESSION_NOT_FOUND', `for ${joinCode}`);
    viewer.close();
  }
  await settle();
});

test('joining by share link works the same as by code', async () => {
  const { host, link } = await attachedHost();

  const viewer = await Client.open();
  viewer.send({ type: 'session.viewer.request', joinToken: link });

  const pending = await host.next('session.viewer.pending');
  if (pending.payload.type !== 'session.viewer.pending') assert.fail('wrong type');
  assert.equal(pending.payload.request.joinedVia, 'link');

  host.close();
  viewer.close();
  await settle();
});

test('the host leaving ends the session for the viewer', async () => {
  const { host, code } = await attachedHost();

  const viewer = await Client.open();
  viewer.send({ type: 'session.viewer.request', joinCode: code });
  const pending = await host.next('session.viewer.pending');
  if (pending.payload.type !== 'session.viewer.pending') assert.fail('wrong type');
  host.send({
    type: 'session.viewer.approve',
    participantId: pending.payload.request.participantId,
  });
  await viewer.next('session.viewer.approved');

  host.close();

  const ended = await viewer.next('session.ended');
  if (ended.payload.type !== 'session.ended') assert.fail('wrong type');
  assert.equal(ended.payload.reason, 'host_ended');

  viewer.close();
  await settle();
});

test('a viewer leaving tells the host', async () => {
  const { host, code } = await attachedHost();

  const viewer = await Client.open();
  viewer.send({ type: 'session.viewer.request', joinCode: code });
  const pending = await host.next('session.viewer.pending');
  if (pending.payload.type !== 'session.viewer.pending') assert.fail('wrong type');
  const viewerId = pending.payload.request.participantId;

  viewer.close();
  const left = await host.next('peer.left');
  if (left.payload.type !== 'peer.left') assert.fail('wrong type');
  assert.equal(left.payload.participantId, viewerId);

  host.close();
  await settle();
});

after(() => {
  // The server holds the event loop open; nothing else needs tearing down.
  setTimeout(() => process.exit(0), 200);
});
