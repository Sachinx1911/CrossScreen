import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

import { HEARTBEAT, parseClientEnvelope } from '@crossscreen/protocol';

import { config } from './config.ts';
import { handleDisconnect, handleMessage, sendError, type Connection } from './handlers.ts';
import { log } from './log.ts';
import { InMemorySessionStore, startSweeper } from './session-store.ts';
import { send } from './handlers.ts';

/**
 * The signaling service.
 *
 * It carries offer, answer and ICE between two peers and decides who may
 * receive them. It never sees media, and it never inspects SDP.
 */

const store = new InMemorySessionStore();

const http = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, sessions: store.size }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server: http });

wss.on('connection', (socket: WebSocket, req) => {
  const connection: Connection = {
    socket,
    userAgent: req.headers['user-agent'],
    remoteAddress: req.socket.remoteAddress,
  };

  let alive = true;
  socket.on('pong', () => {
    alive = true;
  });

  const heartbeat = setInterval(() => {
    if (!alive) {
      log.warn('peer.timeout', { participantId: connection.participantId });
      socket.terminate();
      return;
    }
    alive = false;
    socket.ping();
  }, HEARTBEAT.intervalMs);

  socket.on('message', (data: Buffer) => {
    // Every inbound frame is untrusted. parseClientEnvelope applies the size
    // cap and the protocol-version check before anything else looks at it.
    const parsed = parseClientEnvelope(data);
    if (!parsed.ok) {
      log.warn('message.rejected', { code: parsed.code, detail: parsed.detail });
      sendError(socket, parsed.code);
      return;
    }
    void handleMessage(connection, parsed.value.payload, parsed.value.id, store).catch(
      (err: unknown) => {
        // A handler throwing must not take the socket down with it, and must
        // not leave the client waiting for a reply that is never coming.
        log.error('handler.failed', {
          type: parsed.value.payload.type,
          message: err instanceof Error ? err.message : String(err),
        });
        sendError(socket, 'INTERNAL_ERROR', parsed.value.id);
      },
    );
  });

  socket.on('close', (code, reason) => {
    clearInterval(heartbeat);
    handleDisconnect(connection, store);
    log.info('connection.closed', {
      participantId: connection.participantId,
      code,
      reason: reason.toString(),
    });
  });

  socket.on('error', (err: Error) => {
    log.error('socket.error', { participantId: connection.participantId, message: err.message });
  });
});

// Sessions have to expire on a timer as well as on disconnect: a host whose
// laptop slept, or a session nobody ever joined, produces no event to react to.
startSweeper(store, (session) => {
  for (const viewer of session.viewers) {
    send(viewer.socket, {
      type: 'session.ended',
      reason: session.endedReason === 'expired' ? 'expired' : 'idle_timeout',
    });
  }
  send(session.hostSocket, {
    type: 'session.ended',
    reason: session.endedReason === 'expired' ? 'expired' : 'idle_timeout',
  });
  log.info('session.expired', { sessionId: session.sessionId, reason: session.endedReason });
});

function onListenError(err: NodeJS.ErrnoException): void {
  if (err.code === 'EADDRINUSE') {
    log.error('signaling.port_in_use', {
      port: config.port,
      hint: 'Another signaling server is already running. Stop it, or set SIGNALING_PORT.',
    });
    process.exit(1);
  }
  log.error('signaling.listen_failed', { message: err.message });
  process.exit(1);
}

// `ws` re-emits the HTTP server's errors on the WebSocketServer, so both need
// a handler or a port clash becomes an unhandled 'error' event and a stack
// trace instead of a message the developer can act on.
http.on('error', onListenError);
wss.on('error', onListenError);

http.listen(config.port, config.host, () => {
  log.info('signaling.listening', { host: config.host, port: config.port });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log.info('signaling.stopping', { signal });
    wss.close();
    http.close(() => process.exit(0));
  });
}
