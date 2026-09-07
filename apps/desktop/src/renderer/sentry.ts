import { scrubSentryEvent } from '@crossscreen/observability';
import * as Sentry from '@sentry/electron/renderer';

import { sentryDsn } from './config.ts';

/**
 * Starts error reporting for the renderer process
 * (phase-2-reliability.md §2.6), if a DSN is configured. The mirror of
 * `apps/web`'s own `sentry.ts` — see that file for the reasoning, which
 * applies unchanged here.
 *
 * `@sentry/electron/renderer` rather than `@sentry/react` directly: it knows
 * this is an Electron renderer specifically, which matters for how a crash
 * is captured versus a browser tab. No preload-based IPC bridge to the main
 * process is wired — each process reports independently, which loses the
 * main/renderer event correlation the bridge would give and nothing else;
 * worth adding if that correlation is ever actually needed.
 */
export function initSentry(): void {
  const dsn = sentryDsn();
  if (dsn === undefined) return;

  Sentry.init({
    dsn,
    sendDefaultPii: false,
    beforeSend: (event) =>
      scrubSentryEvent(event as unknown as Record<string, unknown>) as unknown as typeof event,
  });
}

/** The mirror of `apps/web`'s own `tagParticipant` — see that file's comment for what this is and is not. */
export function tagParticipant(participantId: string): void {
  Sentry.setTag('participantId', participantId);
}
