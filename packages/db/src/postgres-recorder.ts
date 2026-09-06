import type { Logger } from '@crossscreen/logging';
import postgres, { type Sql } from 'postgres';

import type { AbuseEvent, ConnectionStat, Recorder, SessionEvent } from './types.ts';

/**
 * Records to PostgreSQL, in batches, off the critical path.
 *
 * Two decisions shape this:
 *
 * **Nothing awaits a write.** Recording is observability, and observability
 * must not be able to break the thing it observes. A session that fails
 * because a database was slow is a far worse outcome than a session nobody has
 * a record of, so every method returns immediately and failures are logged
 * rather than raised.
 *
 * **Writes are batched.** A connection stat arrives every two seconds per
 * participant, which is a lot of round trips to spend on numbers whose value
 * is entirely in aggregate. A short flush interval loses at most that much on
 * a crash, which is an acceptable trade for observability data.
 */

/**
 * `sql.json()` rather than `JSON.stringify` for the jsonb columns.
 *
 * A stringified object arrives as a JSON *string* — `jsonb_typeof` returns
 * 'string' and `detail->>'key'` returns nothing at all. The rows are written
 * and are then unqueryable, which is the worst version of this to have: the
 * data looks present and answers no questions.
 */
const FLUSH_INTERVAL_MS = 2_000;
/** A ceiling so a database outage cannot turn into unbounded memory use. */
const MAX_QUEUED = 5_000;

export class PostgresRecorder implements Recorder {
  readonly #sql: Sql;
  readonly #log: Logger;
  readonly #events: SessionEvent[] = [];
  readonly #stats: ConnectionStat[] = [];
  readonly #abuse: AbuseEvent[] = [];
  readonly #timer: ReturnType<typeof setInterval>;
  #dropped = 0;

  constructor(databaseUrl: string, log: Logger) {
    this.#log = log;
    this.#sql = postgres(databaseUrl, {
      max: 4,
      idle_timeout: 30,
      connect_timeout: 10,
      onnotice: () => undefined,
    });

    this.#timer = setInterval(() => {
      void this.#flush();
    }, FLUSH_INTERVAL_MS);
    // Otherwise this timer alone keeps the process alive at shutdown.
    this.#timer.unref();
  }

  sessionEvent(event: SessionEvent): void {
    this.#enqueue(this.#events, event);
  }

  connectionStat(stat: ConnectionStat): void {
    this.#enqueue(this.#stats, stat);
  }

  abuseEvent(event: AbuseEvent): void {
    this.#enqueue(this.#abuse, event);
  }

  async close(): Promise<void> {
    clearInterval(this.#timer);
    await this.#flush();
    await this.#sql.end({ timeout: 5 });
  }

  #enqueue<T>(queue: T[], item: T): void {
    if (queue.length >= MAX_QUEUED) {
      // Report the loss rather than growing without limit. A database that has
      // been unreachable long enough to fill this is a problem to be told
      // about, not one to absorb until the process runs out of memory.
      this.#dropped += 1;
      if (this.#dropped % 1000 === 1) {
        this.#log.error('db.queue_full', { dropped: this.#dropped });
      }
      return;
    }
    queue.push(item);
  }

  async #flush(): Promise<void> {
    const events = this.#events.splice(0, this.#events.length);
    const stats = this.#stats.splice(0, this.#stats.length);
    const abuse = this.#abuse.splice(0, this.#abuse.length);
    if (events.length + stats.length + abuse.length === 0) return;

    try {
      if (events.length > 0) {
        await this.#sql`
          INSERT INTO session_events ${this.#sql(
            events.map((e) => ({
              session_id: e.sessionId,
              event: e.event,
              participant_id: e.participantId ?? null,
              detail: e.detail === undefined ? null : this.#sql.json(e.detail),
            })),
            'session_id',
            'event',
            'participant_id',
            'detail',
          )}`;
      }

      if (stats.length > 0) {
        await this.#sql`
          INSERT INTO connection_stats ${this.#sql(
            stats.map((s) => ({
              session_id: s.sessionId,
              participant_id: s.participantId ?? null,
              transport: s.transport,
              quality: s.quality ?? null,
              round_trip_ms: s.roundTripMs ?? null,
              resolution: s.resolution ?? null,
              codec: s.codec ?? null,
              frames_per_second: s.framesPerSecond ?? null,
            })),
            'session_id',
            'participant_id',
            'transport',
            'quality',
            'round_trip_ms',
            'resolution',
            'codec',
            'frames_per_second',
          )}`;
      }

      if (abuse.length > 0) {
        await this.#sql`
          INSERT INTO abuse_log ${this.#sql(
            abuse.map((a) => ({
              event: a.event,
              ip_hash: a.ipHash ?? null,
              detail: a.detail === undefined ? null : this.#sql.json(a.detail),
            })),
            'event',
            'ip_hash',
            'detail',
          )}`;
      }
    } catch (err) {
      // Deliberately not re-queued. Retrying into a database that is refusing
      // writes turns one outage into a growing backlog, and these rows are
      // worth having, not worth guaranteeing.
      this.#log.error('db.write_failed', {
        message: err instanceof Error ? err.message : String(err),
        lost: events.length + stats.length + abuse.length,
      });
    }
  }
}
