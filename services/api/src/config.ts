import { log } from './log.ts';

/**
 * Configuration, read once at startup.
 *
 * Nothing is hardcoded at a call site (architecture §77), and a bad value stops
 * the process with one structured line naming the variable — the same way the
 * signaling service treats a bad port. A service that starts with nonsense
 * configuration fails later, somewhere less obvious.
 */

function reject(name: string, raw: string, reason: string): never {
  log.error('api.bad_config', { variable: name, value: raw, reason });
  process.exit(1);
}

function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    reject(name, raw, 'must be a whole number, with nothing else in it');
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (parsed < min || parsed > max) reject(name, raw, `must be between ${min} and ${max}`);
  return parsed;
}

/**
 * The secret that signs host tokens, shared with the signaling service
 * (ADR-0011). It is the only thing standing between a stranger and a token
 * naming any session they like, so it is refused rather than defaulted.
 *
 * A development fallback would be the obvious convenience and exactly the wrong
 * one: it would work locally, survive review, and reach production as a
 * publicly known signing key. Failing to start is the cheaper outcome by a very
 * wide margin.
 */
function secretFromEnv(name: string, minLength: number): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    reject(name, '', `is required — generate one with: openssl rand -base64 32`);
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

  port: intFromEnv('API_PORT', 8788, 1, 65535),
  host: process.env['API_HOST'] ?? '127.0.0.1',

  /** Must match the signaling service's, or no host token will verify. */
  sessionSecret: secretFromEnv('SESSION_SECRET', 32),

  /**
   * ICE servers handed to clients. Static here; Phase 2 replaces this endpoint
   * with short-lived Cloudflare credentials, which is why clients ask for it
   * rather than hardcoding anything (ADR-0004).
   */
  stunUrls: (process.env['STUN_URLS'] ?? 'stun:stun.l.google.com:19302')
    .split(',')
    .map((u) => u.trim())
    .filter((u) => u !== ''),

  turnUrls: (process.env['TURN_URLS'] ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter((u) => u !== ''),
  turnUsername: process.env['TURN_USERNAME'] ?? '',
  turnCredential: process.env['TURN_CREDENTIAL'] ?? '',

  /** Where share links point. Only used to build the link we hand back. */
  appOrigin: process.env['APP_ORIGIN'] ?? 'http://localhost:5173',
} as const;
