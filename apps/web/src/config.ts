/**
 * Viewer configuration.
 *
 * The signaling URL and ICE servers come from the environment rather than
 * being hardcoded, because the Phase 0.5 cross-network test runs against a
 * cloudflared tunnel URL that changes on every restart.
 *
 * TURN credentials sitting in a build-time variable is a **deliberate,
 * disclosed shortcut for Phase 0.5 only**. Phase 2 replaces this with
 * `GET /api/v1/ice-servers` issuing short-lived credentials (ADR-0004).
 */

const env = import.meta.env as Record<string, string | undefined>;

function signalingUrl(): string {
  const configured = env['VITE_SIGNALING_URL'];
  if (configured !== undefined && configured !== '') return configured;

  // Same-origin fallback, so a tunnel that fronts both works without config.
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws`;
}

export function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

  const turnUrls = env['VITE_TURN_URLS'];
  const turnUser = env['VITE_TURN_USERNAME'];
  const turnCredential = env['VITE_TURN_CREDENTIAL'];

  if (turnUrls !== undefined && turnUser !== undefined && turnCredential !== undefined) {
    servers.push({
      urls: turnUrls.split(',').map((u) => u.trim()),
      username: turnUser,
      credential: turnCredential,
    });
  }

  return servers;
}

/**
 * Forces every candidate through TURN. This is how the relay path is proven
 * independently of P2P — exit criterion 4 of Phase 0.5. Without a way to force
 * it, the relay path is only exercised by accident and silently rots.
 */
export function forceRelay(): boolean {
  return new URLSearchParams(location.search).get('relay') === '1';
}

export const config = {
  signalingUrl: signalingUrl(),
  statsIntervalMs: 2000,
};
