import { scrubSentryEvent } from '@crossscreen/observability';
import * as Sentry from '@sentry/node';

import { config } from './config.ts';

/**
 * Starts error reporting (phase-2-reliability.md §2.6), if a DSN is
 * configured. Called once, before anything else in `server.ts`, so a crash
 * during startup itself is still reported rather than only crashes after the
 * service is already listening.
 *
 * Returns whether it actually started, so the caller can log the one-time
 * "not configured" line the same way `databaseUrl` and
 * `cloudflareTurnKeyId` already do. That logging deliberately does not live
 * in here: `log.ts` reports every `log.error` call to Sentry too, and a
 * two-way import between this file and that one is the kind of cycle that
 * works today and breaks on the next refactor.
 */
export function initSentry(): boolean {
  if (config.sentryDsn === undefined || config.sentryDsn === '') return false;

  Sentry.init({
    dsn: config.sentryDsn,
    // No IP, no cookies, no request body captured by default — scrubEvent
    // below is the second layer, never the only one.
    sendDefaultPii: false,
    beforeSend: (event) =>
      scrubSentryEvent(event as unknown as Record<string, unknown>) as unknown as typeof event,
  });
  return true;
}
