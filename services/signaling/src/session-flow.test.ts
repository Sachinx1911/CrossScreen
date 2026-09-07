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

test('an ICE restart request is relayed, with a server-asserted sender, in either direction', async () => {
  // The plumbing `SharerSession`/`ViewerSession` rely on for §2.3's media-path
  // recovery: whichever side notices a real connection failure can ask the
  // other for a restart, gated by the same approval as everything else.
  const { host, code, hostId } = await attachedHost();

  const viewer = await Client.open();
  viewer.send({ type: 'session.viewer.request', joinCode: code });
  const pending = await host.next('session.viewer.pending');
  if (pending.payload.type !== 'session.viewer.pending') assert.fail('wrong type');
  const viewerId = pending.payload.request.participantId;
  host.send({ type: 'session.viewer.approve', participantId: viewerId });
  await viewer.next('session.viewer.approved');

  // Viewer asks the host — the common case, since the sharer is always the
  // offerer and only it can actually perform the restart.
  viewer.send({ type: 'rtc.restart', to: hostId });
  const askedHost = await host.next('rtc.restart');
  if (askedHost.payload.type !== 'rtc.restart') assert.fail('wrong type');
  assert.equal(askedHost.payload.from, viewerId, 'the sender is asserted by the server');

  // And the reverse works too, for whichever side notices first.
  host.send({ type: 'rtc.restart', to: viewerId });
  const askedViewer = await viewer.next('rtc.restart');
  if (askedViewer.payload.type !== 'rtc.restart') assert.fail('wrong type');
  assert.equal(askedViewer.payload.from, hostId);

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

test('a second viewer is turned away once one is already approved', async () => {
  // Phase 1 is one sharer, one viewer (architecture §11). The host is never
  // shown a prompt for a request that could not be approved anyway.
  const { host, code } = await attachedHost();

  const first = await Client.open();
  first.send({ type: 'session.viewer.request', joinCode: code });
  const pending = await host.next('session.viewer.pending');
  if (pending.payload.type !== 'session.viewer.pending') assert.fail('wrong type');
  host.send({
    type: 'session.viewer.approve',
    participantId: pending.payload.request.participantId,
  });
  await first.next('session.viewer.approved');

  const second = await Client.open();
  second.send({ type: 'session.viewer.request', joinCode: code });

  const err = await second.next('error');
  if (err.payload.type !== 'error') assert.fail('wrong type');
  assert.equal(err.payload.code, 'SESSION_FULL');
  await host.never('session.viewer.pending');

  first.close();
  second.close();
  host.close();
  await settle();
});

test('a second pending viewer cannot be approved once the first one is', async () => {
  // The narrower race the request gate alone does not cover: two viewers ask
  // before either is decided, so both reach `pending`, and the host approves
  // the first and then — a stray double-click, or a client replaying the
  // message — tries to approve the second too.
  const { host, code } = await attachedHost();

  const first = await Client.open();
  first.send({ type: 'session.viewer.request', joinCode: code });
  const firstPending = await host.next('session.viewer.pending');
  if (firstPending.payload.type !== 'session.viewer.pending') assert.fail('wrong type');

  const second = await Client.open();
  second.send({ type: 'session.viewer.request', joinCode: code });
  const secondPending = await host.next('session.viewer.pending');
  if (secondPending.payload.type !== 'session.viewer.pending') assert.fail('wrong type');

  host.send({
    type: 'session.viewer.approve',
    participantId: firstPending.payload.request.participantId,
  });
  await first.next('session.viewer.approved');

  host.send({
    type: 'session.viewer.approve',
    participantId: secondPending.payload.request.participantId,
  });
  const err = await host.next('error');
  if (err.payload.type !== 'error') assert.fail('wrong type');
  assert.equal(err.payload.code, 'SESSION_FULL');
  await second.never('session.viewer.approved');

  host.close();
  first.close();
  second.close();
  await settle();
});

test('a host whose socket drops keeps the session, and rebinds to it', async () => {
  // §2.3's rule, over the wire: a network blip must not cost anyone their
  // code. The viewer here never disconnects and is never told anything —
  // media is peer-to-peer, so from where they sit nothing happened at all.
  const { token, code } = await newHostToken();

  const host = await Client.open();
  host.send({ type: 'session.host.attach', hostToken: token });
  await host.next('session.state');

  const viewer = await Client.open();
  viewer.send({ type: 'session.viewer.request', joinCode: code });
  const pending = await host.next('session.viewer.pending');
  if (pending.payload.type !== 'session.viewer.pending') assert.fail('wrong type');
  const viewerId = pending.payload.request.participantId;
  host.send({ type: 'session.viewer.approve', participantId: viewerId });
  await viewer.next('session.viewer.approved');

  host.close();
  await settle();

  // Nothing was announced to the viewer: it is still watching.
  await viewer.never('session.ended');

  const returning = await Client.open();
  returning.send({ type: 'session.host.attach', hostToken: token });
  const state = await returning.next('session.state');
  if (state.payload.type !== 'session.state') assert.fail('wrong type');

  // The same session, with the same viewer still in it and still approved.
  assert.equal(state.payload.session.joinCode, code);
  const viewers = state.payload.session.participants.filter((p) => p.role === 'viewer');
  assert.equal(viewers.length, 1, 'the viewer survived the outage');
  assert.equal(viewers[0]?.state, 'connected', 'and did not fall back to pending');

  // And negotiation resumes without a second approval round.
  returning.send({ type: 'rtc.offer', to: viewerId, sdp: SDP });
  const offer = await viewer.next('rtc.offer');
  if (offer.payload.type !== 'rtc.offer') assert.fail('wrong type');
  assert.equal(offer.payload.sdp, SDP);

  returning.close();
  viewer.close();
  await settle();
});

test('an approved viewer whose socket drops resumes without a second approval', async () => {
  // The viewer-side mirror of the host reattach test above, over the wire.
  const { host, code } = await attachedHost();

  const viewer = await Client.open();
  viewer.send({ type: 'session.viewer.request', joinCode: code });
  const pending = await host.next('session.viewer.pending');
  if (pending.payload.type !== 'session.viewer.pending') assert.fail('wrong type');
  const viewerId = pending.payload.request.participantId;
  host.send({ type: 'session.viewer.approve', participantId: viewerId });
  const approved = await viewer.next('session.viewer.approved');
  if (approved.payload.type !== 'session.viewer.approved') assert.fail('wrong type');
  const participantToken = approved.payload.participantToken;

  viewer.close();
  await settle();

  // Held, not announced — the host sees nothing while the grace period runs.
  await host.never('peer.left');

  const returning = await Client.open();
  returning.send({
    type: 'session.viewer.request',
    joinCode: code,
    resume: { participantId: viewerId, participantToken },
  });

  const state = await returning.next('session.state');
  if (state.payload.type !== 'session.state') assert.fail('wrong type');
  assert.equal(state.payload.you, viewerId, 'the same identity, not a fresh one');
  const self = state.payload.session.participants.find((p) => p.participantId === viewerId);
  assert.equal(self?.state, 'connected', 'resumed straight in, not re-queued as pending');

  // The host is never bothered with a prompt for someone it already approved.
  await host.never('session.viewer.pending');

  // And negotiation works immediately, over the new socket.
  host.send({ type: 'rtc.offer', to: viewerId, sdp: SDP });
  const offer = await returning.next('rtc.offer');
  if (offer.payload.type !== 'rtc.offer') assert.fail('wrong type');
  assert.equal(offer.payload.sdp, SDP);

  host.close();
  returning.close();
  await settle();
});

test('a resume with the wrong token cannot steal a slot someone else is still holding', async () => {
  // The real viewer is only away, not gone — its approved slot is held for
  // the whole grace period — so a mismatched resume falls back to an ordinary
  // request and meets the same one-viewer-at-a-time rule anyone else would.
  // It must not be handed the seat just because it guessed the participant id.
  const { host, code } = await attachedHost();

  const viewer = await Client.open();
  viewer.send({ type: 'session.viewer.request', joinCode: code });
  const pending = await host.next('session.viewer.pending');
  if (pending.payload.type !== 'session.viewer.pending') assert.fail('wrong type');
  const viewerId = pending.payload.request.participantId;
  host.send({ type: 'session.viewer.approve', participantId: viewerId });
  await viewer.next('session.viewer.approved');

  viewer.close();
  await settle();

  const impostor = await Client.open();
  impostor.send({
    type: 'session.viewer.request',
    joinCode: code,
    resume: { participantId: viewerId, participantToken: 'not-the-real-token' },
  });

  const err = await impostor.next('error');
  if (err.payload.type !== 'error') assert.fail('wrong type');
  assert.equal(err.payload.code, 'SESSION_FULL');
  await host.never('session.viewer.pending');

  host.close();
  impostor.close();
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

test('a host that means to stop ends the session for the viewer', async () => {
  // The deliberate ending, as distinct from a dropped socket. Since §2.3 a
  // socket closing is treated as a blip and the session is held, so saying so
  // explicitly is the only way to end one early — which is what
  // `SharerSession.stop()` sends before it closes anything.
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

  host.send({ type: 'session.end' });

  const ended = await viewer.next('session.ended');
  if (ended.payload.type !== 'session.ended') assert.fail('wrong type');
  assert.equal(ended.payload.reason, 'host_ended');

  host.close();
  viewer.close();
  await settle();
});

test('a host socket dropping is held, not announced as an ending', async () => {
  // The counterpart to the test above, and the reason it had to change: this
  // used to be the same event. Someone walking between Wi-Fi and mobile data
  // must not be reported to their viewer as having ended the session.
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
  await settle();

  await viewer.never('session.ended');

  viewer.close();
  await settle();
});

test('an approved viewer leaving on purpose is told to the host immediately, not held', async () => {
  // The point of session.viewer.leave: without it, a deliberate departure is
  // indistinguishable from a dropped socket, and the host would go on seeing
  // "watching" until the away-viewer grace period ran out on its own.
  const { host, code } = await attachedHost();

  const viewer = await Client.open();
  viewer.send({ type: 'session.viewer.request', joinCode: code });
  const pending = await host.next('session.viewer.pending');
  if (pending.payload.type !== 'session.viewer.pending') assert.fail('wrong type');
  const viewerId = pending.payload.request.participantId;
  host.send({ type: 'session.viewer.approve', participantId: viewerId });
  await viewer.next('session.viewer.approved');

  viewer.send({ type: 'session.viewer.leave' });

  const left = await host.next('peer.left');
  if (left.payload.type !== 'peer.left') assert.fail('wrong type');
  assert.equal(left.payload.participantId, viewerId);

  host.close();
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
