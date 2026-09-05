/**
 * Structured logging.
 *
 * One line of JSON per event, because the questions we will actually ask of
 * these logs — which peer, which message, how long — are queries, not prose.
 * Replaced by Pino in Phase 1; the call sites stay the same.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const threshold = ORDER[(process.env['LOG_LEVEL'] as Level) ?? 'info'] ?? ORDER.info;

function emit(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  if (ORDER[level] < threshold) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...fields });
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const log = {
  debug: (event: string, fields?: Record<string, unknown>): void => {
    emit('debug', event, fields);
  },
  info: (event: string, fields?: Record<string, unknown>): void => {
    emit('info', event, fields);
  },
  warn: (event: string, fields?: Record<string, unknown>): void => {
    emit('warn', event, fields);
  },
  error: (event: string, fields?: Record<string, unknown>): void => {
    emit('error', event, fields);
  },
};
