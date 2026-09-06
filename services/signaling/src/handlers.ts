import {
  envelope,
  errorMessage,
  verifyHostToken,
  type ClientMessage,
  type ErrorCode,
  type ServerMessage,
} from '@crossscreen/protocol';
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
  userAgent: string | undefined;
  remoteAddress: string | undefined;
  /** Set once the socket identifies itself. */
  sessionId?: string;
  participantId?: string;
  role?: 'host' | 'viewer';
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

  const session = new LiveSession(result.claims, connection.socket);
  store.add(session);

  connection.sessionId = session.sessionId;
  connection.participantId = session.hostId;
  connection.role = 'host';

  send(
    connection.socket,
    { type: 'session.state', session: session.summary(), you: session.hostId },
    id,
  );
  log.info('host.attached', { sessionId: session.sessionId, joinCode: session.joinCode });
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
    log.warn('viewer.request_refused', {
      reason: 'not_found',
      joinedVia: payload.joinToken !== undefined ? 'link' : 'code',
      ip: connection.remoteAddress,
    });
    return;
  }

  if (session.endedReason !== undefined) {
    sendError(connection.socket, 'SESSION_EXPIRED', id);
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
    sendError(connection.socket, 'SESSION_NOT_FOUND', id);
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
  log.info('viewer.rejected', { sessionId: session.sessionId, participantId: viewer.id });
}

function endSession(connection: Connection, id: string, store: SessionStore): void {
  const session = requireHost(connection, id, store);
  if (session === undefined) return;

  session.endedReason = 'host_ended';
  for (const viewer of session.viewers) {
    send(viewer.socket, { type: 'session.ended', reason: 'host_ended' });
  }
  store.remove(session.sessionId);
  log.info('session.ended', { sessionId: session.sessionId, reason: 'host_ended' });
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
    case 'rtc.offer':
    case 'rtc.answer':
    case 'rtc.ice':
    case 'rtc.restart':
      relay(connection, payload, id, store);
      return;
    case 'stats.report':
      // Logged rather than stored until Phase 2 builds the pipeline. The
      // direct-versus-relay ratio is the number that predicts TURN cost.
      log.info('stats.report', {
        sessionId: connection.sessionId,
        participantId: connection.participantId,
        transport: payload.transport,
        quality: payload.quality,
        roundTripMs: payload.roundTripMs,
      });
      return;
  }
}

/** A socket closing: tidy up, and tell whoever is left. */
export function handleDisconnect(connection: Connection, store: SessionStore): void {
  if (connection.sessionId === undefined) return;
  const session = store.byId(connection.sessionId);
  if (session === undefined) return;

  if (connection.role === 'host') {
    // Without a host there is nothing to watch, so the session goes with it.
    session.endedReason = 'host_ended';
    for (const viewer of session.viewers) {
      send(viewer.socket, { type: 'session.ended', reason: 'host_ended' });
    }
    store.remove(session.sessionId);
    log.info('session.ended', { sessionId: session.sessionId, reason: 'host_left' });
    return;
  }

  if (connection.participantId !== undefined && session.removeViewer(connection.participantId)) {
    send(session.hostSocket, { type: 'peer.left', participantId: connection.participantId });
    log.info('viewer.left', {
      sessionId: session.sessionId,
      participantId: connection.participantId,
    });
  }
}
