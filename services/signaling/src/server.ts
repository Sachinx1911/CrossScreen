import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

import { HEARTBEAT, parseClientEnvelope, type ClientMessage } from '@crossscreen/protocol';

import { config } from './config.ts';
import { log } from './log.ts';
import { SkeletonRoom, type Peer } from './room.ts';

/**
 * Phase 0.5 signaling server.
 *
 * Its only job is to carry offer, answer and ICE candidates between two peers
 * so that the media path can be proven end to end. It never sees media, and
 * it never inspects SDP — the payload is relayed verbatim.
 */

const room = new SkeletonRoom();

const http = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, peers: room.size }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server: http });

wss.on('connection', (socket: WebSocket, req) => {
  const peer = room.add(socket);

  if (peer === null) {
    log.warn('connection.refused', { reason: 'room_full', remote: req.socket.remoteAddress });
    socket.close(1013, 'Room full');
    return;
  }

  let alive = true;
  socket.on('pong', () => {
    alive = true;
  });

  const heartbeat = setInterval(() => {
    if (!alive) {
      log.warn('peer.timeout', { peerId: peer.id });
      socket.terminate();
      return;
    }
    alive = false;
    socket.ping();
  }, HEARTBEAT.intervalMs);

  socket.on('message', (data: Buffer) => {
    handleMessage(peer, data);
  });

  socket.on('close', (code, reason) => {
    clearInterval(heartbeat);
    room.remove(peer.id);
    log.info('connection.closed', { peerId: peer.id, code, reason: reason.toString() });
  });

  socket.on('error', (err: Error) => {
    log.error('socket.error', { peerId: peer.id, message: err.message });
  });
});

function handleMessage(peer: Peer, data: Buffer): void {
  // Every inbound frame is untrusted. parseClientEnvelope applies the size cap
  // and the protocol-version check before anything else looks at it.
  const parsed = parseClientEnvelope(data);
  if (!parsed.ok) {
    log.warn('message.rejected', { peerId: peer.id, code: parsed.code, detail: parsed.detail });
    room.sendError(peer, parsed.code);
    return;
  }

  const { id, payload } = parsed.value;

  switch (payload.type) {
    case 'ping':
      room.send(peer, { type: 'pong' }, id);
      return;

    case 'rtc.offer':
    case 'rtc.answer':
    case 'rtc.ice':
    case 'rtc.restart':
      relay(peer, payload, id);
      return;

    case 'stats.report':
      // Not persisted in this phase; logged so the walking-skeleton run can be
      // read back afterwards. Phase 2 lands these in connection_stats.
      log.info('stats.report', { peerId: peer.id, ...payload });
      return;

    default:
      // Session and approval messages have no meaning in a hardcoded room.
      log.warn('message.unsupported', { peerId: peer.id, type: payload.type });
      room.sendError(peer, 'MALFORMED_MESSAGE', id);
  }
}

/**
 * Forward a negotiation message to the other peer, replacing the client's
 * `to` with a server-asserted `from`. The client cannot forge its identity,
 * and the SDP itself is passed through untouched.
 */
function relay(
  peer: Peer,
  payload: Extract<ClientMessage, { type: `rtc.${string}` }>,
  inReplyTo: string,
): void {
  const target = room.other(peer.id);
  if (target === undefined) {
    room.sendError(peer, 'SESSION_NOT_FOUND', inReplyTo);
    return;
  }

  const { to: _discarded, ...rest } = payload;
  room.send(target, { ...rest, from: peer.id });
  log.debug('relay', { type: payload.type, from: peer.id, to: target.id });
}

http.listen(config.port, config.host, () => {
  log.info('signaling.listening', {
    host: config.host,
    port: config.port,
    room: config.skeletonRoomId,
  });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log.info('signaling.stopping', { signal });
    wss.close();
    http.close(() => process.exit(0));
  });
}
