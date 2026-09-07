import * as Sentry from '@sentry/node';

import { buildApp } from './app.ts';
import { config } from './config.ts';
import { log } from './log.ts';
import { initSentry } from './sentry.ts';

/**
 * Process entry point. Everything interesting is in `app.ts`; this file exists
 * to bind a socket and to stop cleanly.
 */

// First, so a crash anywhere below — including during startup itself — is
// still reported (phase-2-reliability.md §2.6).
if (!initSentry()) {
  log.warn('sentry.not_configured', {
    hint: 'SENTRY_DSN is not set. Errors are logged but not reported.',
  });
}

// Anything reaching here bypassed every request handler entirely — a bad
// promise somewhere outside Fastify's own lifecycle, or a synchronous throw
// during setup. Nothing caught it, so nothing logged it either, until now.
process.on('uncaughtException', (err) => {
  Sentry.captureException(err);
  log.error('api.uncaught_exception', { message: err.message });
  // Node's own guidance: the process is in a state nothing here trusts once
  // this fires. Exiting is the safe answer; a supervisor restarts it clean.
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  Sentry.captureException(reason);
  log.error('api.unhandled_rejection', {
    message: reason instanceof Error ? reason.message : String(reason),
  });
});

const app = buildApp();

try {
  await app.listen({ port: config.port, host: config.host });
  log.info('api.listening', { host: config.host, port: config.port });
} catch (err) {
  const e = err as NodeJS.ErrnoException;
  if (e.code === 'EADDRINUSE') {
    log.error('api.port_in_use', {
      port: config.port,
      hint: 'Another API server is already running. Stop it, or set API_PORT.',
    });
  } else {
    log.error('api.listen_failed', { message: e.message });
  }
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log.info('api.stopping', { signal });
    void app.close().then(() => process.exit(0));
  });
}
