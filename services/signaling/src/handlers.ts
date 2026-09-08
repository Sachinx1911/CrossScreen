import {
  envelope,
  errorMessage,
  verifyHostToken,
  type ClientMessage,
  type ErrorCode,
  type ServerMessage,
} from '@crossscreen/protocol';
import type { Recorder } from '@crossscreen/db';
import type { RateLimiter } from '@crossscreen/rate-limit';
import type { WebSocket } from 'ws';

import { config } from './config.ts';
import { deviceLabelFrom } from './device-label.ts';
import { LiveSession } from './live-session.ts';
import { log } from './log.ts';
import type { SessionStore } from './session-store.ts';

/**
 * The session protocol.
 *
 * One rule governs this file, and everything else is in service of it:
 *
 *   **No WebRTC negotiation is relayed to a viewer the host has not approved.**
 *
 * That is what makes a six-digit join code safe (ADR-0006). The code is a
 * lookup key; approval is the grant. `LiveSession.mayRelay` is the single
 * place that decides, so there is one thing to read and one thing to test.
 */

/** What a socket is, from this service's point of view. */
export interface Connection {
  socket: WebSocket;
  /** Where durable records go. A no-op when no database is configured. */
  recorder: Recorder;
  /** Shared across every connection, keyed by `ipHash` (phase-3a-production.md §3.1). */
  joinAttemptLimiter: RateLimiter;
  userAgent: string | undefined;
  /**
   * A keyed hash of the address, never the address. Enough to count repeats
   * from one source, not enough to identify anyone.
   */
  ipHash: string | undefined;
  /** Set once the socket identifies itself. */
  sessionId?: string;
  participantId?: string;
  role?: 'host' | 'viewer';
  /**
   * Set the first time this socket reports `connectionState: 'connected'`.
   *
   * Guards the one-time `connected` session event below: `stats.report`
   * arrives every couple of seconds for as long as the peer connection lives,
   * and "time to connect" (phase-2-reliability.md §2.4) needs exactly one
   * timestamp per connection, not one per report.
   */
  connectedRecorded?: boolean;
}

export function send(socket: WebSocket, message: ServerMessage, id?: string): void {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(envelope(message, id)));
}

export function sendError(socket: WebSocket, code: ErrorCode, inReplyTo?: string): void {
  send(socket, errorMessage(code, inReplyTo));
}

/**
 * The host proves it created this session by presenting a token this service
 * can verify without asking anyone (ADR-0011). The live session begins here.
 */
async function hostAttach(
  connection: Connection,
  hostToken: string,
  id: string,
  store: SessionStore,
): Promise<void> {
  const result = await verifyHostToken(hostToken, config.sessionSecret);

  if (!result.ok) {
    // 'expired' is distinguished because it is the one a legitimate host can
    // act on — start a new session. The rest are alike on purpose.
    sendError(
      connection.socket,
      result.reason === 'expired' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
      id,
    );
    log.warn('host.attach_refused', { reason: result.reason });
    return;
  }

  // A host coming back from a dropped socket rebinds to the session it left,
  // keeping the viewers already approved into it. Building a fresh one here
  // would silently strand them: same join code, but an empty participant list,
  // so nothing could be relayed to anyone and each would have to ask
  // permission again — which §2.3 counts as a failure, not a recovery.
  const existing = store.byId(result.claims.sid);
  const resumed = existing !== undefined && existing.endedReason === undefined;

  const session = existing ?? new LiveSession(result.claims, connection.socket);
  if (resumed) session.rebindHost(connection.socket);
  else store.add(session);

  connection.sessionId = session.sessionId;
  connection.participantId = session.hostId;
  connection.role = 'host';

  connection.recorder.sessionEvent({
    sessionId: session.sessionId,
    event: 'host_attached',
    participantId: session.hostId,
    ...(resumed ? { detail: { resumed: true } } : {}),
  });

  send(
    connection.socket,
    { type: 'session.state', session: session.summary(), you: session.hostId },
    id,
  );
  log.info(resumed ? 'host.resumed' : 'host.attached', {
    sessionId: session.sessionId,
    joinCode: session.joinCode,
    ...(resumed ? { viewers: session.viewers.length } : {}),
  });
}

/**
 * A viewer asks to join.
 *
 * It is called `request` rather than `join` because that is what it is: the
 * viewer is placed in `pending` and the host is notified. **No SDP is
 * exchanged at this point**, and none will be until the host approves.
 */
function viewerRequest(
  connection: Connection,
  payload: Extract<ClientMessage, { type: 'session.viewer.request' }>,
  id: string,
  store: SessionStore,
): void {
  // Checked before the lookup, deliberately: this is what actually stops
  // enumeration (ADR-0006, phase-3a-production.md §3.1) — a limit applied
  // only to failures would still let someone try five *correct-looking*
  // codes a second. `ipHash` is undefined only when the socket had no
  // remote address at all, an edge case rare enough that failing open on it
  // — rather than lumping every such connection into one shared bucket — is
  // the safer default.
  if (connection.ipHash !== undefined) {
    const result = connection.joinAttemptLimiter.hit(connection.ipHash);
    if (!result.allowed) {
      sendError(connection.socket, 'RATE_LIMITED', id);
      log.warn('viewer.request_refused', { reason: 'rate_limited' });
      return;
    }
  }

  const session =
    payload.joinToken !== undefined
      ? store.byToken(payload.joinToken)
      : payload.joinCode !== undefined
        ? store.byCode(payload.joinCode)
        : undefined;

  if (session === undefined) {
    // A code with no live session and a guessed code get the same answer, so
    // someone enumerating codes learns nothing about which ones exist.
    sendError(connection.socket, 'SESSION_NOT_FOUND', id);
    // Counted for Phase 3a's rate limiting, against a keyed hash rather than
    // the address itself (architecture §42).
    connection.recorder.abuseEvent({
      event: 'code_attempt_failed',
      ...(connection.ipHash === undefined ? {} : { ipHash: connection.ipHash }),
      detail: { joinedVia: payload.joinToken !== undefined ? 'link' : 'code' },
    });
    log.warn('viewer.request_refused', {
      reason: 'not_found',
      joinedVia: payload.joinToken !== undefined ? 'link' : 'code',
    });
    return;
  }

  if (session.endedReason !== undefined) {
    sendError(connection.socket, 'SESSION_EXPIRED', id);
    return;
  }

  // A locked session refuses every *new* join attempt — but not a resume: a
  // viewer already approved before the lock tripped presenting its own
  // credentials is not a guess, and the lock exists to stop guessing, not to
  // drop someone who was already let in.
  if (session.locked && payload.resume === undefined) {
    sendError(connection.socket, 'SESSION_LOCKED', id);
    log.warn('viewer.request_refused', { reason: 'locked', sessionId: session.sessionId });
    return;
  }

  // Tried before the one-viewer check below, deliberately: a viewer resuming
  // its own slot must never be turned away as "full" by itself. A resume that
  // does not check out — wrong token, already reclaimed by the grace-period
  // sweep — falls straight through to an ordinary fresh request rather than
  // an error (§2.3): it should look exactly like joining for the first time.
  if (payload.resume !== undefined) {
    const resumed = session.rebindViewer(
      payload.resume.participantId,
      payload.resume.participantToken,
      connection.socket,
    );
    if (resumed !== undefined) {
      connection.sessionId = session.sessionId;
      connection.participantId = resumed.id;
      connection.role = 'viewer';

      send(
        connection.socket,
        { type: 'session.state', session: session.summary(), you: resumed.id },
        id,
      );
      // The host was never told this viewer left — the grace period exists
      // precisely so it would not be — so there is nothing for it to be told
      // now either.
      connection.recorder.sessionEvent({
        sessionId: session.sessionId,
        event: 'viewer_approved',
        participantId: resumed.id,
        detail: { resumed: true },
      });
      log.info('viewer.resumed', { sessionId: session.sessionId, participantId: resumed.id });
      return;
    }
  }

  // Phase 1 is one sharer, one viewer (architecture §11) — a second stranger
  // is turned away before the host is ever bothered with a prompt for a
  // request that could not be approved anyway. Revisit for Phase 5's mesh.
  if (session.approvedViewers.length > 0) {
    sendError(connection.socket, 'SESSION_FULL', id);
    log.warn('viewer.request_refused', { reason: 'full', sessionId: session.sessionId });
    return;
  }

  const viewer = session.addViewer({
    deviceLabel: deviceLabelFrom(connection.userAgent),
    approximateLocation: undefined,
    joinedVia: payload.joinToken !== undefined ? 'link' : 'code',
    socket: connection.socket,
  });

  connection.sessionId = session.sessionId;
  connection.participantId = viewer.id;
  connection.role = 'viewer';

  // The host gets what it needs to recognise the person it sent the link to.
  send(session.hostSocket, {
    type: 'session.viewer.pending',
    request: {
      participantId: viewer.id,
      deviceLabel: viewer.deviceLabel,
      joinedVia: viewer.joinedVia,
      requestedAt: viewer.requestedAt,
      ...(viewer.approximateLocation === undefined
        ? {}
        : { approximateLocation: viewer.approximateLocation }),
    },
  });

  send(
    connection.socket,
    { type: 'session.state', session: session.summary(), you: viewer.id },
    id,
  );
  connection.recorder.sessionEvent({
    sessionId: session.sessionId,
    event: 'viewer_requested',
    participantId: viewer.id,
    // The label is coarse by design and holds nothing identifying.
    detail: { joinedVia: viewer.joinedVia, deviceLabel: viewer.deviceLabel },
  });

  log.info('viewer.pending', { sessionId: session.sessionId, participantId: viewer.id });
}

/** Only the host decides. The server enforces that rather than trusting a flag. */
function requireHost(
  connection: Connection,
  id: string,
  store: SessionStore,
): LiveSession | undefined {
  const session = connection.sessionId === undefined ? undefined : store.byId(connection.sessionId);
  if (session === undefined) {
    sendError(connection.socket, 'SESSION_NOT_FOUND', id);
    return undefined;
  }
  if (connection.role !== 'host' || connection.participantId !== session.hostId) {
    sendError(connection.socket, 'NOT_SESSION_HOST', id);
    log.warn('host_action_refused', {
      sessionId: session.sessionId,
      participantId: connection.participantId,
    });
    return undefined;
  }
  return session;
}

function approve(
  connection: Connection,
  participantId: string,
  id: string,
  store: SessionStore,
): void {
  const session = requireHost(connection, id, store);
  if (session === undefined) return;

  const viewer = session.approve(participantId);
  if (viewer === undefined) {
    // Two hosts clicking Allow on two prompts in the same instant is the only
    // realistic way to reach this: the request gate above already turns away
    // anyone who asks after someone is watching, so "full" is distinguished
    // from "gone" only for a host who genuinely hit both at once.
    sendError(
      connection.socket,
      session.approvedViewers.length > 0 ? 'SESSION_FULL' : 'SESSION_NOT_FOUND',
      id,
    );
    return;
  }

  // The participant token is issued here and nowhere else — after approval,
  // scoped to one session and one participant.
  send(viewer.socket, {
    type: 'session.viewer.approved',
    participantId: viewer.id,
    participantToken: viewer.token ?? '',
  });

  send(session.hostSocket, {
    type: 'peer.joined',
    participant: {
      participantId: viewer.id,
      role: 'viewer',
      state: 'connected',
      deviceLabel: viewer.deviceLabel,
      joinedAt: viewer.approvedAt ?? Date.now(),
    },
  });

  connection.recorder.sessionEvent({
    sessionId: session.sessionId,
    event: 'viewer_approved',
    participantId: viewer.id,
  });
  log.info('viewer.approved', { sessionId: session.sessionId, participantId: viewer.id });
}

function reject(
  connection: Connection,
  participantId: string,
  id: string,
  store: SessionStore,
): void {
  const session = requireHost(connection, id, store);
  if (session === undefined) return;

  const viewer = session.reject(participantId);
  if (viewer === undefined) {
    sendError(connection.socket, 'SESSION_NOT_FOUND', id);
    return;
  }

  send(viewer.socket, { type: 'session.viewer.rejected' });
  session.removeViewer(viewer.id);
  connection.recorder.sessionEvent({
    sessionId: session.sessionId,
    event: 'viewer_rejected',
    participantId: viewer.id,
  });
  log.info('viewer.rejected', { sessionId: session.sessionId, participantId: viewer.id });

  // A rejection counts against the session regardless of who made the
  // request (ADR-0006, phase-3a-production.md §3.1) — the per-IP RateLimiter
  // in server.ts is the other half of this, for a guesser who rotates
  // addresses instead of repeatedly hitting the same one.
  if (session.recordFailedAttempt()) {
    connection.recorder.abuseEvent({
      event: 'session_locked',
      detail: { sessionId: session.sessionId },
    });
    log.warn('session.locked', { sessionId: session.sessionId });
  }
}

function endSession(connection: Connection, id: string, store: SessionStore): void {
  const session = requireHost(connection, id, store);
  if (session === undefined) return;

  session.endedReason = 'host_ended';
  for (const viewer of session.viewers) {
    send(viewer.socket, { type: 'session.ended', reason: 'host_ended' });
  }
  connection.recorder.sessionEvent({
    sessionId: session.sessionId,
    event: 'ended',
    detail: { reason: 'host_ended' },
  });
  store.remove(session.sessionId);
  log.info('session.ended', { sessionId: session.sessionId, reason: 'host_ended' });
}

/**
 * A viewer says it is leaving on purpose.
 *
 * The mirror of `endSession`: removed immediately rather than held for the
 * away-viewer grace period, because this is the case that grace period exists
 * to be skipped for — a genuine departure, not a dropped socket (§2.3). It
 * runs ahead of the socket actually closing, so by the time `handleDisconnect`
 * fires for real there is no viewer left in the session for it to hold.
 */
function viewerLeave(connection: Connection, store: SessionStore): void {
  if (connection.role !== 'viewer' || connection.sessionId === undefined) return;
  const session = store.byId(connection.sessionId);
  if (session === undefined || connection.participantId === undefined) return;

  const viewer = session.viewer(connection.participantId);
  if (viewer === undefined) return;

  session.removeViewer(viewer.id);
  send(session.hostSocket, { type: 'peer.left', participantId: viewer.id });
  connection.recorder.sessionEvent({
    sessionId: session.sessionId,
    event: 'viewer_left',
    participantId: viewer.id,
    detail: { reason: 'left' },
  });
  log.info('viewer.left', { sessionId: session.sessionId, participantId: viewer.id });
}

/**
 * Relay one negotiation message.
 *
 * The client's `to` is checked rather than trusted, and replaced with a
 * server-asserted `from` so a client cannot claim to be someone else. SDP and
 * candidates pass through untouched — this service never inspects media
 * negotiation, it only decides who may receive it.
 */
function relay(
  connection: Connection,
  payload: Extract<ClientMessage, { type: `rtc.${string}` }>,
  id: string,
  store: SessionStore,
): void {
  const session = connection.sessionId === undefined ? undefined : store.byId(connection.sessionId);
  const from = connection.participantId;

  if (session === undefined || from === undefined) {
    sendError(connection.socket, 'SESSION_NOT_FOUND', id);
    return;
  }

  if (!session.mayRelay(from, payload.to)) {
    // The single most important refusal in the service. A pending viewer
    // reaching this means the approval gate did its job.
    sendError(connection.socket, 'JOIN_REJECTED', id);
    log.warn('relay_refused', {
      sessionId: session.sessionId,
      from,
      to: payload.to,
      type: payload.type,
    });
    return;
  }

  const target = session.socketFor(payload.to);
  if (target === undefined) {
    sendError(connection.socket, 'SESSION_NOT_FOUND', id);
    return;
  }

  const { to: _discarded, ...rest } = payload;
  send(target, { ...rest, from });
}

export async function handleMessage(
  connection: Connection,
  payload: ClientMessage,
  id: string,
  store: SessionStore,
): Promise<void> {
  switch (payload.type) {
    case 'ping':
      send(connection.socket, { type: 'pong' }, id);
      return;
    case 'session.host.attach':
      await hostAttach(connection, payload.hostToken, id, store);
      return;
    case 'session.viewer.request':
      viewerRequest(connection, payload, id, store);
      return;
    case 'session.viewer.approve':
      approve(connection, payload.participantId, id, store);
      return;
    case 'session.viewer.reject':
      reject(connection, payload.participantId, id, store);
      return;
    case 'session.end':
      endSession(connection, id, store);
      return;
    case 'session.viewer.leave':
      viewerLeave(connection, store);
      return;
    case 'rtc.offer':
    case 'rtc.answer':
    case 'rtc.ice':
    case 'rtc.restart':
      relay(connection, payload, id, store);
      return;
    case 'stats.report':
      // The direct-versus-relay ratio across these rows is the number that
      // predicts TURN cost, and the reason connection_stats exists (ADR-0004).
      if (connection.sessionId !== undefined) {
        connection.recorder.connectionStat({
          sessionId: connection.sessionId,
          ...(connection.participantId === undefined
            ? {}
            : { participantId: connection.participantId }),
          transport: payload.transport,
          quality: payload.quality,
          ...(payload.roundTripMs === undefined ? {} : { roundTripMs: payload.roundTripMs }),
          ...(payload.packetLossPct === undefined ? {} : { packetLossPct: payload.packetLossPct }),
          ...(payload.bitrateKbps === undefined ? {} : { bitrateKbps: payload.bitrateKbps }),
          ...(payload.resolution === undefined ? {} : { resolution: payload.resolution }),
          ...(payload.codec === undefined ? {} : { codec: payload.codec }),
          ...(payload.framesPerSecond === undefined
            ? {}
            : { framesPerSecond: payload.framesPerSecond }),
          connectionState: payload.connectionState,
        });

        // One row per connection, not per report: this is what "time to
        // connect" (§2.4) is measured against, alongside whichever of
        // `created` / `host_attached` / `viewer_approved` is the right
        // starting point for the query being asked.
        if (payload.connectionState === 'connected' && connection.connectedRecorded !== true) {
          connection.connectedRecorded = true;
          connection.recorder.sessionEvent({
            sessionId: connection.sessionId,
            event: 'connected',
            ...(connection.participantId === undefined
              ? {}
              : { participantId: connection.participantId }),
          });
        }
      }
      return;
  }
}

/** A socket closing: tidy up, and tell whoever is left. */
export function handleDisconnect(connection: Connection, store: SessionStore): void {
  if (connection.sessionId === undefined) return;
  const session = store.byId(connection.sessionId);
  if (session === undefined) return;

  if (connection.role === 'host') {
    // Held, not ended. A dropped socket is far more often a network blip than
    // someone finishing — and media is peer-to-peer, so anyone watching is
    // still watching right now. The sweeper ends it if the host does not come
    // back within the grace period; `session.end` is how a host who actually
    // meant it says so.
    //
    // Viewers are told nothing, deliberately: nothing they can see has
    // changed, and a warning that resolves itself in two seconds is worse
    // than silence.
    session.hostAwaySince = Date.now();
    log.info('host.away', { sessionId: session.sessionId });
    return;
  }

  if (connection.participantId === undefined) return;
  const viewer = session.viewer(connection.participantId);
  if (viewer === undefined) return;

  if (viewer.state === 'approved') {
    // The viewer-side mirror of the host branch above, for the same reason:
    // media is peer-to-peer, so whatever this viewer was watching is very
    // often still playing while signaling is away. Held rather than removed;
    // `expireAwayViewers` drops it once the grace period actually runs out,
    // and only then is the host told `peer.left`.
    viewer.awaySince = Date.now();
    log.info('viewer.away', { sessionId: session.sessionId, participantId: viewer.id });
    return;
  }

  // A pending request has no connection to preserve — there is nothing
  // playing yet — so it is removed immediately, the same as an explicit
  // leave or rejection, clearing the prompt on the host's screen right away.
  session.removeViewer(viewer.id);
  send(session.hostSocket, { type: 'peer.left', participantId: viewer.id });
  log.info('viewer.left', { sessionId: session.sessionId, participantId: viewer.id });
}
