import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

import { createRecorder, hashIp } from '@crossscreen/db';
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
const recorder = createRecorder(config.databaseUrl, log);

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
    recorder,
    userAgent: req.headers['user-agent'],
    // Hashed at the edge, so the address itself never travels further into the
    // service than this line (architecture §42).
    ipHash: hashIp(req.socket.remoteAddress, config.sessionSecret),
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
  recorder.sessionEvent({
    sessionId: session.sessionId,
    event: 'ended',
    detail: { reason: session.endedReason ?? 'expired' },
  });
  log.info('session.expired', { sessionId: session.sessionId, reason: session.endedReason });
});

// A per-viewer clock, not a per-session one, so it runs on its own schedule
// rather than piggybacking on the 30s session sweep — a request left pending
// deserves an answer sooner than that, and JOIN_REQUEST_TIMEOUT_MS would be
// pointless to turn down for a test if the check only ran every 30 seconds.
const joinRequestSweep = setInterval(() => {
  for (const { session, viewer } of store.expireStaleJoinRequests(config.joinRequestTimeoutMs)) {
    sendError(viewer.socket, 'JOIN_REQUEST_TIMED_OUT');
    // The same message a viewer leaving mid-wait already sends: it clears the
    // prompt on the host's screen, so nobody can approve a request that has
    // already been answered.
    send(session.hostSocket, { type: 'peer.left', participantId: viewer.id });
    recorder.sessionEvent({
      sessionId: session.sessionId,
      event: 'viewer_rejected',
      participantId: viewer.id,
      detail: { reason: 'timed_out' },
    });
    log.info('viewer.request_timed_out', {
      sessionId: session.sessionId,
      participantId: viewer.id,
    });
  }
}, 1_000);
joinRequestSweep.unref();

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
    // Flush what is queued before going, so a clean restart does not throw
    // away the last couple of seconds of records.
    void recorder.close().then(() => {
      http.close(() => process.exit(0));
    });
  });
}
