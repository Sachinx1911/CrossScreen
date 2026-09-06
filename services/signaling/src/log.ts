import { createLogger, levelFromEnv } from '@crossscreen/logging';

/**
 * The signaling service's logger.
 *
 * A module of its own so `config.ts` can report its own rejections without
 * importing something that imports it back.
 */
export const log = createLogger('signaling', levelFromEnv(process.env['LOG_LEVEL']));
