import { createLogger, levelFromEnv } from '@crossscreen/logging';

export const log = createLogger('api', levelFromEnv(process.env['LOG_LEVEL']));
