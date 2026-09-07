import { createLogger, levelFromEnv, type Logger } from '@crossscreen/logging';
import * as Sentry from '@sentry/node';

const base = createLogger('api', levelFromEnv(process.env['LOG_LEVEL']));

/**
 * Every `log.error` call also reaches Sentry (phase-2-reliability.md §2.6),
 * without touching any of the call sites that already exist — this is a
 * decorator on the one method that means something went wrong, not a second
 * thing to remember to call.
 *
 * `Sentry.captureMessage` rather than `captureException`: `Logger.error`
 * takes an event name and a field bag, not an `Error` object, so there is no
 * stack trace to attach here regardless of which call is used. The two real
 * catch boundaries that still hold the original `Error` — the request error
 * handler and the top-level process guards, both in `server.ts` — call
 * `captureException` directly, for exactly that reason.
 *
 * Safe to call whether or not `initSentry()` ever ran: an uninitialized
 * Sentry client is a documented no-op, not a throw.
 */
export const log: Logger = {
  ...base,
  error: (event, fields) => {
    base.error(event, fields);
    Sentry.captureMessage(
      event,
      fields === undefined ? 'error' : { level: 'error', extra: fields },
    );
  },
};
