/**
 * Sharer configuration for Phase 0.5.
 *
 * Read from Vite build-time environment so the cross-network test can point at
 * whatever URL cloudflared hands out on a given day. TURN credentials living
 * here is a **disclosed shortcut for this phase only** — Phase 2 replaces it
 * with `GET /api/v1/ice-servers` issuing short-lived credentials (ADR-0004).
 */

const env = import.meta.env as Record<string, string | undefined>;

export function signalingUrl(): string {
  return env['VITE_SIGNALING_URL'] ?? 'ws://127.0.0.1:8787';
}

export function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

  const urls = env['VITE_TURN_URLS'];
  const username = env['VITE_TURN_USERNAME'];
  const credential = env['VITE_TURN_CREDENTIAL'];

  if (urls !== undefined && username !== undefined && credential !== undefined) {
    servers.push({ urls: urls.split(',').map((u) => u.trim()), username, credential });
  }
  return servers;
}

/** Phase 0.5 exit criterion 4: prove the relay path independently of P2P. */
export function forceRelay(): boolean {
  return env['VITE_FORCE_RELAY'] === '1';
}

/**
 * Starts sharing without waiting for a click.
 *
 * For automated local verification only — a real sharer must always be an
 * explicit user action, and Phase 1 adds the source picker and the first-share
 * safety notice in front of it.
 */
export function autoStart(): boolean {
  return env['VITE_AUTOSTART'] === '1';
}

export const STATS_INTERVAL_MS = 2000;
