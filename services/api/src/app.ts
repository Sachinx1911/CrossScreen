import Fastify, { type FastifyInstance } from 'fastify';

import { log } from './log.ts';
import { createSession, iceServers } from './sessions.ts';

/**
 * The HTTP API.
 *
 * Built as a function returning an app rather than a module with side effects,
 * so tests can start one on an ephemeral port without the process listening,
 * and so `server.ts` stays the only thing that binds a socket.
 */
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false, trustProxy: true });

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

    log.info('session.created', {
      // The code is logged and the tokens are not. A code is a lookup key that
      // grants nothing; a host token grants authorship of the session, and
      // logs are the wrong place for it to live (architecture §42).
      joinCode: session.joinCode,
      expiresAt: session.expiresAt,
      ip: request.ip,
    });

    return reply.code(201).send(session);
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
