import { scrubSentryEvent } from '@crossscreen/observability';
import * as Sentry from '@sentry/react';

import { sentryDsn } from './config.ts';

/**
 * Starts error reporting (phase-2-reliability.md §2.6), if a DSN is
 * configured. Called once, before the app renders, so a crash during the
 * very first render is still reported — `@sentry/react`'s own `init` already
 * wires `window.onerror` and `unhandledrejection` globally, which covers
 * everything else without a custom error boundary.
 */
export function initSentry(): void {
  const dsn = sentryDsn();
  if (dsn === undefined) return;

  Sentry.init({
    dsn,
    // No IP, no cookies, no request body captured by default — scrubEvent
    // below is the second layer, never the only one.
    sendDefaultPii: false,
    beforeSend: (event) =>
      scrubSentryEvent(event as unknown as Record<string, unknown>) as unknown as typeof event,
  });
}

/**
 * The client never learns the internal session id — `sessionSummarySchema`
 * says so explicitly, and architecture §7 is why: it is the recorder's key,
 * not something a client is trusted with. `participantId` is what a client
 * genuinely has, and `connection_stats`/`session_events` carry it on every
 * row (phase-2-reliability.md §2.4) — enough to go from a report here to the
 * rows about that connection without crossing the boundary the server
 * enforces everywhere else.
 */
export function tagParticipant(participantId: string): void {
  Sentry.setTag('participantId', participantId);
}
