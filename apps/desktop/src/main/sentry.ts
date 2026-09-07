import { scrubSentryEvent } from '@crossscreen/observability';
import * as Sentry from '@sentry/electron/main';

/**
 * Starts error reporting for the Electron main process
 * (phase-2-reliability.md §2.6), if a DSN is configured.
 *
 * Read from `process.env` directly rather than through a `config.ts` module
 * like the two services have: this process has no equivalent of their
 * `.env.local` loading (`CROSSSCREEN_SIGNALING_URL`, the only other env var
 * this process reads, works the same way) — a packaged build sets
 * `SENTRY_DSN` in its own environment rather than shipping a `.env` file.
 *
 * Called as the very first thing in `main.ts`, so a crash during startup
 * itself — before a window even opens — is still reported.
 */
export function initSentry(): void {
  const dsn = process.env['SENTRY_DSN'];
  if (dsn === undefined || dsn === '') return;

  Sentry.init({
    dsn,
    sendDefaultPii: false,
    beforeSend: (event) =>
      scrubSentryEvent(event as unknown as Record<string, unknown>) as unknown as typeof event,
  });
}
