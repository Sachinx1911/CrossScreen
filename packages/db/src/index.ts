import type { Logger } from '@crossscreen/logging';

import { NoopRecorder } from './noop-recorder.ts';
import { PostgresRecorder } from './postgres-recorder.ts';
import type { Recorder } from './types.ts';

export * from './types.ts';
export * from './hash-ip.ts';
export { NoopRecorder } from './noop-recorder.ts';
export { PostgresRecorder } from './postgres-recorder.ts';

/**
 * A recorder, or a convincing impression of one.
 *
 * Without `DATABASE_URL` this returns the no-op, so a fresh clone runs with no
 * Postgres installed. That is deliberate: this project moves between two
 * machines, and requiring a database to see the product work would be friction
 * for no benefit. The no-op says so loudly once, so a production deployment
 * cannot lose everything silently.
 */
export function createRecorder(databaseUrl: string | undefined, log: Logger): Recorder {
  if (databaseUrl === undefined || databaseUrl.trim() === '') return new NoopRecorder(log);
  return new PostgresRecorder(databaseUrl.trim(), log);
}
