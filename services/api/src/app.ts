import cors from '@fastify/cors';
import { createRecorder, type Recorder } from '@crossscreen/db';
import Fastify, { type FastifyInstance } from 'fastify';

import { config } from './config.ts';
import { log } from './log.ts';
import { createSession, iceServers } from './sessions.ts';

/**
 * The HTTP API.
 *
 * Built as a function returning an app rather than a module with side effects,
 * so tests can start one on an ephemeral port without the process listening,
 * and so `server.ts` stays the only thing that binds a socket.
 */
export function buildApp(
  recorder: Recorder = createRecorder(config.databaseUrl, log),
): FastifyInstance {
  const app = Fastify({ logger: false, trustProxy: true });

  app.addHook('onClose', async () => {
    await recorder.close();
  });

  /**
   * The desktop renderer runs at `app://bundle`, so every call it makes is
   * cross-origin. Without this it is blocked outright and the app cannot
   * create a session at all — which is exactly what happened.
   *
   * `app://bundle` is ours by construction: the scheme is registered by the
   * main process and nothing else can serve it.
   */
  void app.register(cors, {
    origin: [
      'app://bundle',
      config.appOrigin,
      ...config.allowedOrigins,
      // Development only. A deployment sets ALLOWED_ORIGINS explicitly.
      ...(process.env['NODE_ENV'] === 'production'
        ? []
        : [/^http:\/\/(localhost|127\.0\.0\.1):\d+$/]),
    ],
    methods: ['GET', 'POST'],
  });

  app.get('/healthz', () => ({ ok: true }));

  /**
   * Create a session.
   *
   * Deliberately unauthenticated: MVP sessions are anonymous (ADR-0007).
   * Rate limiting arrives in Phase 3a — until then this is an open endpoint,
   * which is fine on a developer machine and must not reach the internet
   * without it.
   */
  app.post('/api/v1/sessions', async (request, reply) => {
    const session = await createSession();

    // The internal id is recorded, the join code is not: a durable table of
    // codes would outlive the sessions they belong to for no purpose.
    recorder.sessionEvent({
      sessionId: session.sessionId,
      event: 'created',
      detail: { expiresAt: session.expiresAt },
    });

    log.info('session.created', {
      // The code is logged and the tokens are not. A code is a lookup key that
      // grants nothing; a host token grants authorship of the session, and
      // logs are the wrong place for it to live (architecture §42).
      joinCode: session.joinCode,
      expiresAt: session.expiresAt,
      ip: request.ip,
    });

    // `sessionId` is stripped rather than never created: the recorder needs
    // it, and the client must not see it (architecture §7).
    const { sessionId: _internal, ...body } = session;
    return reply.code(201).send(body);
  });

  /**
   * ICE configuration.
   *
   * Static in Phase 1. Phase 2 makes it short-lived Cloudflare credentials,
   * and because clients ask rather than hardcode, that change reaches them
   * without a release (ADR-0004).
   */
  app.get('/api/v1/ice-servers', () => ({ iceServers: iceServers() }));

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'not_found' }));

  return app;
}
