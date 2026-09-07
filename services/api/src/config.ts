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

  /** STUN needs no credential, so unlike TURN it is simply static. */
  stunUrls: (process.env['STUN_URLS'] ?? 'stun:stun.l.google.com:19302')
    .split(',')
    .map((u) => u.trim())
    .filter((u) => u !== ''),

  /**
   * The long-term Cloudflare key this service uses to mint short-lived TURN
   * credentials per request (turn.ts, ADR-0004) — never handed to a client
   * itself. Absent is allowed: without it, `/api/v1/ice-servers` serves
   * STUN-only, which still works between two friendly networks, and `turn.ts`
   * warns once at startup rather than failing every session over it.
   *
   * `pnpm turn` copies both values from `.env.turn` (per the one-time
   * dashboard setup in dev-setup.md) into this service's own `.env.local`.
   */
  cloudflareTurnKeyId: process.env['CLOUDFLARE_TURN_KEY_ID'],
  cloudflareTurnApiToken: process.env['CLOUDFLARE_TURN_API_TOKEN'],

  /**
   * How long a minted TURN credential is valid for. Short enough to be a real
   * claim of "short-lived" against a key that never expires on its own; long
   * enough that the common case — one session, including a possible ICE
   * restart later in it — never needs a second one. `REFRESH_MARGIN_MS` in
   * turn.ts refetches ahead of this, so a client is never handed one about to
   * lapse.
   */
  turnTtlSeconds: intFromEnv('TURN_CREDENTIAL_TTL_SECONDS', 4 * 60 * 60, 60, 24 * 60 * 60),

  /** Where share links point. Only used to build the link we hand back. */
  appOrigin: process.env['APP_ORIGIN'] ?? 'http://localhost:5173',

  /**
   * Origins allowed to call this API from a browser.
   *
   * The web app does not need one — the dev server proxies `/api` so it is
   * same-origin, and a deployment sits behind one hostname. **The desktop app
   * does**: its renderer is served from `app://bundle`, so every call it makes
   * is cross-origin and was being blocked outright.
   *
   * An allow-list rather than `*`, because these endpoints will carry rate
   * limits keyed to the caller in Phase 3a.
   */
  allowedOrigins: (process.env['ALLOWED_ORIGINS'] ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o !== ''),

  /**
   * Where errors go (phase-2-reliability.md §2.6). Absent is allowed, the
   * same way `databaseUrl` and `cloudflareTurnKeyId` are: without it, the
   * service runs with error reporting off and says so once at startup,
   * rather than a fresh clone needing a Sentry account to start at all.
   */
  sentryDsn: process.env['SENTRY_DSN'],
} as const;
