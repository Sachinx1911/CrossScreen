import { createLogger, levelFromEnv, type Logger } from '@crossscreen/logging';
import * as Sentry from '@sentry/node';

/**
 * The signaling service's logger.
 *
 * A module of its own so `config.ts` can report its own rejections without
 * importing something that imports it back.
 *
 * Every `log.error` call also reaches Sentry (phase-2-reliability.md §2.6) —
 * see `services/api/src/log.ts` for the full reasoning, which applies here
 * unchanged.
 */
const base = createLogger('signaling', levelFromEnv(process.env['LOG_LEVEL']));

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
