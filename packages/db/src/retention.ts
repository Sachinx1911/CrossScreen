import postgres from 'postgres';

/**
 * Deletes rows older than the retention window, from the three tables that
 * otherwise grow forever (phase-3a-production.md §3.3). `session_events` and
 * `connection_stats` fill up at one row per connection per couple of
 * seconds — nothing about "make the connection survive the real world"
 * (Phase 2) or "make it safe to expose to the internet" (this phase) ever
 * asked the database to keep all of it indefinitely. `abuse_log` is much
 * lower volume but carries the same obligation architecture §42 already
 * makes for everything else here: nothing is kept longer than it has a
 * reason to be.
 *
 * Plain SQL and a short runner, the same choice `migrate.ts` already made
 * and explained: three tables do not need a job scheduler's worth of
 * configuration to clean up.
 *
 * Run: pnpm --filter @crossscreen/db retention
 * Schedule in production as a daily cron/systemd timer — this script does
 * one pass and exits, it does not loop or wait.
 */

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl === '') {
  console.error('DATABASE_URL is not set.\n');
  console.error('  postgres://user:password@localhost:5432/crossscreen');
  process.exit(1);
}

const raw = process.env['DATA_RETENTION_DAYS'] ?? '30';
const days = Number.parseInt(raw, 10);
if (!/^\d+$/.test(raw) || days < 1) {
  console.error(`DATA_RETENTION_DAYS must be a positive whole number of days, got "${raw}".`);
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });

// `make_interval` rather than string concatenation: `days` reaches the
// database as a bound parameter either way, never spliced into the query
// text, but this also means Postgres — not this script — is the one doing
// the date arithmetic, which is the version worth trusting.
const sessionEvents = await sql`
  DELETE FROM session_events WHERE occurred_at < now() - make_interval(days => ${days})`;
const connectionStats = await sql`
  DELETE FROM connection_stats WHERE occurred_at < now() - make_interval(days => ${days})`;
const abuseLog = await sql`
  DELETE FROM abuse_log WHERE occurred_at < now() - make_interval(days => ${days})`;

console.log(
  `Deleted ${sessionEvents.count} session_events, ${connectionStats.count} connection_stats, ` +
    `${abuseLog.count} abuse_log rows older than ${days} day(s).`,
);

await sql.end();
