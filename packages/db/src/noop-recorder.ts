import type { Logger } from '@crossscreen/logging';

import type { AbuseEvent, ConnectionStat, Recorder, SessionEvent } from './types.ts';

/**
 * Recording with nowhere to record to.
 *
 * Used when `DATABASE_URL` is not set, so a clone runs with no Postgres
 * installed — this project moves between two machines and requiring a database
 * to see the product work would be real friction for no benefit.
 *
 * It warns once at startup rather than per event. Silence would let a
 * production deployment lose everything without a word; a line per event would
 * bury the warning it is trying to give.
 */
export class NoopRecorder implements Recorder {
  constructor(log: Logger) {
    log.warn('db.not_configured', {
      hint: 'DATABASE_URL is not set. Session events and connection statistics are not being recorded.',
    });
  }

  // Doing nothing is the behaviour, not an omission.
  sessionEvent(_event: SessionEvent): void {
    return;
  }

  connectionStat(_stat: ConnectionStat): void {
    return;
  }

  abuseEvent(_event: AbuseEvent): void {
    return;
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}
