/**
 * Configuration, read once at startup.
 *
 * Nothing here is hardcoded at a call site (architecture §77). The values are
 * read from the environment so that development, the cloudflared tunnel used
 * for cross-network testing, and eventual production all differ by
 * configuration rather than by code.
 */

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`${name} must be an integer, got "${raw}"`);
  }
  return parsed;
}

export const config = {
  port: intFromEnv('SIGNALING_PORT', 8787),
  host: process.env['SIGNALING_HOST'] ?? '127.0.0.1',
  /**
   * Phase 0.5 only: every connection lands in one room. Phase 1 replaces this
   * with real sessions, join codes and host approval.
   */
  skeletonRoomId: 'skeleton',
  logLevel: process.env['LOG_LEVEL'] ?? 'info',
} as const;
