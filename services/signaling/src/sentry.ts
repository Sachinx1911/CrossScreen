import { scrubSentryEvent } from '@crossscreen/observability';
import * as Sentry from '@sentry/node';

import { config } from './config.ts';

/**
 * Starts error reporting (phase-2-reliability.md §2.6), if a DSN is
 * configured. The mirror of `services/api`'s own `sentry.ts` — see that
 * file's comment for why the "not configured" logging lives in the caller
 * rather than here.
 */
export function initSentry(): boolean {
  if (config.sentryDsn === undefined || config.sentryDsn === '') return false;

  Sentry.init({
    dsn: config.sentryDsn,
    sendDefaultPii: false,
    beforeSend: (event) =>
      scrubSentryEvent(event as unknown as Record<string, unknown>) as unknown as typeof event,
  });
  return true;
}
