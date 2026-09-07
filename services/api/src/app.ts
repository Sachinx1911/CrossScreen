import cors from '@fastify/cors';
import { createRecorder, type Recorder } from '@crossscreen/db';
import * as Sentry from '@sentry/node';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';

import { config } from './config.ts';
import { log } from './log.ts';
import { createSession, iceServers } from './sessions.ts';
import { TurnCredentialSource, type CloudflareTurnConfig } from './turn.ts';

/** `undefined` when the key is not configured — TurnCredentialSource then serves STUN-only. */
function turnConfigFromEnv(): CloudflareTurnConfig | undefined {
  if (config.cloudflareTurnKeyId === undefined || config.cloudflareTurnApiToken === undefined) {
    return undefined;
  }
  return {
    keyId: config.cloudflareTurnKeyId,
    apiToken: config.cloudflareTurnApiToken,
    ttlSeconds: config.turnTtlSeconds,
  };
}

/**
 * The HTTP API.
 *
 * Built as a function returning an app rather than a module with side effects,
 * so tests can start one on an ephemeral port without the process listening,
 * and so `server.ts` stays the only thing that binds a socket.
 */
export function buildApp(
  recorder: Recorder = createRecorder(config.databaseUrl, log),
  turnSource: TurnCredentialSource = new TurnCredentialSource(turnConfigFromEnv(), log),
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
   * The TURN entry is a fresh, short-lived credential — never a long-term
   * secret sitting in a client's own environment — and because clients ask
   * rather than hardcode, moving providers later reaches them without a
   * release (ADR-0004).
   */
  app.get('/api/v1/ice-servers', async () => ({ iceServers: await iceServers(turnSource) }));

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'not_found' }));

  /**
   * Fastify's own default error handler sends a 500 and stops there — with
   * `logger: false` (above), nothing about a route handler throwing was
   * being recorded anywhere at all. `captureException` here, rather than the
   * `log.error` wrapper alone, because this is one of the two places in this
   * service that still holds the real `Error` object with its stack trace,
   * not just a message string reduced to a log field.
   */
  app.setErrorHandler((err: FastifyError, request, reply) => {
    Sentry.captureException(err);
    log.error('api.request_failed', {
      method: request.method,
      url: request.url,
      message: err.message,
    });
    reply.code(err.statusCode ?? 500).send({ error: 'internal_error' });
  });

  return app;
}
