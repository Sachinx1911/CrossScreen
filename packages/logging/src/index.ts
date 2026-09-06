/**
 * Structured logging.
 *
 * One line of JSON per event, because the questions we will actually ask of
 * these logs — which peer, which session, how long — are queries rather than
 * prose. Replaced by Pino when there is a reason; the call sites stay the same.
 *
 * Shared by both services rather than copied into each, so a fix lands once.
 */

export type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

/**
 * `service` prefixes every event, so two services writing to one stream stay
 * tellable apart without inspecting the fields.
 */
export function createLogger(service: string, level: Level = 'info'): Logger {
  const threshold = ORDER[level];

  function emit(at: Level, event: string, fields: Record<string, unknown> = {}): void {
    if (ORDER[at] < threshold) return;
    const line = JSON.stringify({
      t: new Date().toISOString(),
      level: at,
      service,
      event,
      ...fields,
    });
    // Warnings and errors to stderr so a shell pipeline can separate them.
    if (at === 'error' || at === 'warn') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  }

  return {
    debug: (event, fields): void => {
      emit('debug', event, fields);
    },
    info: (event, fields): void => {
      emit('info', event, fields);
    },
    warn: (event, fields): void => {
      emit('warn', event, fields);
    },
    error: (event, fields): void => {
      emit('error', event, fields);
    },
  };
}

/** Read the level from the environment, falling back rather than refusing. */
export function levelFromEnv(value: string | undefined): Level {
  return value !== undefined && value in ORDER ? (value as Level) : 'info';
}
