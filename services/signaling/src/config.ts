/**
 * Configuration, read once at startup.
 *
 * Nothing here is hardcoded at a call site (architecture §77). The values are
 * read from the environment so that development, the cloudflared tunnel used
 * for cross-network testing, and eventual production all differ by
 * configuration rather than by code.
 */

import { RATE_LIMITS, SESSION_TIMEOUTS } from '@crossscreen/protocol';

import { log } from './log.ts';

/** Report and stop, the way a port clash does — not a stack trace. */
function reject(name: string, raw: string, reason: string): never {
  log.error('signaling.bad_config', { variable: name, value: raw, reason });
  process.exit(1);
}

/**
 * `SIGNALING_PORT` is documented as the way around a stuck port, so a typo in
 * it is an ordinary event rather than a strange one. Two kinds got through:
 *
 * `parseInt` stops at the first character that is not a digit, so `8788x` and
 * `87 87` both came back as confident-looking numbers and the server listened
 * somewhere the person did not mean — with `VITE_SIGNALING_URL` still pointing
 * at the port they thought they had chosen. The whole string has to match now.
 *
 * And a number outside the range — `99999`, `-1` — reached `http.listen`,
 * which throws a RangeError *synchronously*. The `error` handler never sees
 * that, so the careful port-in-use reporting was bypassed and it surfaced as
 * an uncaught exception.
 */
function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    reject(name, raw, `must be a whole number, with nothing else in it`);
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (parsed < min || parsed > max) {
    reject(name, raw, `must be between ${min} and ${max}`);
  }
  return parsed;
}

/** Required, never defaulted. See `sessionSecret` below. */
function secretFromEnv(name: string, minLength: number): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    reject(name, '', 'is required — generate one with: openssl rand -base64 32');
  }
  if (raw.trim().length < minLength) {
    reject(name, '(hidden)', `must be at least ${minLength} characters`);
  }
  return raw.trim();
}

export const config = {
  /**
   * Where durable records go. Absent is allowed: the service then runs with a
   * no-op recorder and says so once, so a clone works with no Postgres
   * installed. It is not allowed to be absent quietly in production.
   */
  databaseUrl: process.env['DATABASE_URL'],

  // 0 is excluded deliberately: it means "any free port", and a server whose
  // port nothing else can predict is not useful to point a client at.
  port: intFromEnv('SIGNALING_PORT', 8787, 1, 65535),
  host: process.env['SIGNALING_HOST'] ?? '127.0.0.1',
  /**
   * Verifies host tokens, and must be identical to the API service's — the two
   * share a secret instead of a database (ADR-0011). Refused rather than
   * defaulted: a development fallback would work locally, survive review, and
   * arrive in production as a publicly known signing key.
   */
  sessionSecret: secretFromEnv('SESSION_SECRET', 32),
  /**
   * How long a pending join request waits before it is auto-rejected.
   * Defaulted from the protocol constant so every client's copy of the same
   * number stays the source of truth; overridable so the end-to-end suite can
   * turn it down instead of a test taking a real minute to run.
   */
  joinRequestTimeoutMs: intFromEnv(
    'JOIN_REQUEST_TIMEOUT_MS',
    SESSION_TIMEOUTS.joinRequestMs,
    1_000,
    10 * 60 * 1_000,
  ),
  /**
   * How long an *active* session (one that has had a viewer) is kept once it
   * drops back to zero. Same reasoning as `joinRequestTimeoutMs`: defaulted
   * from the protocol constant, overridable so a test does not wait 5 real
   * minutes to see a session expire.
   */
  sessionIdleTimeoutMs: intFromEnv(
    'SESSION_IDLE_TIMEOUT_MS',
    SESSION_TIMEOUTS.idleMs,
    1_000,
    24 * 60 * 60 * 1_000,
  ),
  /**
   * How long a session nobody has ever joined is kept — longer than the idle
   * timeout by default, because a session waiting to be found and one that
   * was found and emptied are different situations (see `LiveSession.isExpired`).
   */
  sessionUnclaimedTimeoutMs: intFromEnv(
    'SESSION_UNCLAIMED_TIMEOUT_MS',
    SESSION_TIMEOUTS.unclaimedMs,
    1_000,
    24 * 60 * 60 * 1_000,
  ),
  /**
   * How often the sweeper checks for expired sessions. Independent of the
   * timeouts above on purpose — turning `SESSION_IDLE_TIMEOUT_MS` down for a
   * test would be pointless if the check only ran every 30 seconds regardless.
   */
  sessionSweepIntervalMs: intFromEnv('SESSION_SWEEP_INTERVAL_MS', 30_000, 100, 5 * 60 * 1_000),
  /**
   * How long a session is held after the host's socket drops, so the same
   * host can rebind to it rather than everyone starting again (§2.3).
   *
   * Longer than the client's own give-up point (`DEFAULT_BACKOFF.maxElapsedMs`,
   * one minute) so that a client which recovers at the last moment still finds
   * its session waiting. Past that, holding it only keeps a join code alive
   * for a host that has stopped trying.
   */
  hostGraceMs: intFromEnv('HOST_GRACE_MS', 90_000, 1_000, 60 * 60 * 1_000),
  /**
   * The same idea, for an approved viewer's socket dropping. Same default and
   * same reasoning: past the client's own one-minute give-up point, holding
   * the slot only keeps a viewer nobody is returning as from watching.
   */
  viewerGraceMs: intFromEnv('VIEWER_GRACE_MS', 90_000, 1_000, 60 * 60 * 1_000),
  /**
   * Where errors go (phase-2-reliability.md §2.6). Absent is allowed, the
   * same way `databaseUrl` is: without it, the service runs with error
   * reporting off and says so once at startup.
   */
  sentryDsn: process.env['SENTRY_DSN'],
  /**
   * ADR-0006's numbers, overridable for the same reason every other timing
   * constant here is: a wire-level test suite that shares one server process
   * across many tests makes far more than 5 join attempts from one address
   * (127.0.0.1) in the time the whole file takes to run, and needs to turn
   * this up rather than being rate limited by its own test harness.
   */
  codeAttemptsPerMinute: intFromEnv(
    'RATE_LIMIT_CODE_PER_MINUTE',
    RATE_LIMITS.codeAttemptsPerIpPerMinute,
    1,
    1_000_000,
  ),
  codeAttemptsPerHour: intFromEnv(
    'RATE_LIMIT_CODE_PER_HOUR',
    RATE_LIMITS.codeAttemptsPerIpPerHour,
    1,
    1_000_000,
  ),
  // LOG_LEVEL is deliberately absent. It is read in log.ts instead, because
  // this module logs its own rejections and cannot import a logger that
  // imports it back. A `logLevel` here would be read by nothing and changing
  // it would do nothing, which is worse than not offering it.
} as const;
