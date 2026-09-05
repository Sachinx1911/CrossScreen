/**
 * Configuration, read once at startup.
 *
 * Nothing here is hardcoded at a call site (architecture §77). The values are
 * read from the environment so that development, the cloudflared tunnel used
 * for cross-network testing, and eventual production all differ by
 * configuration rather than by code.
 */

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

export const config = {
  // 0 is excluded deliberately: it means "any free port", and a server whose
  // port nothing else can predict is not useful to point a client at.
  port: intFromEnv('SIGNALING_PORT', 8787, 1, 65535),
  host: process.env['SIGNALING_HOST'] ?? '127.0.0.1',
  /**
   * Phase 0.5 only: every connection lands in one room. Phase 1 replaces this
   * with real sessions, join codes and host approval.
   */
  skeletonRoomId: 'skeleton',
  logLevel: process.env['LOG_LEVEL'] ?? 'info',
} as const;
