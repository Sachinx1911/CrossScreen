/**
 * Where the services are.
 *
 * Same-origin by default, which the Vite dev server proxies and a tunnel
 * carries unchanged — so neither development nor the cross-network test needs
 * any configuration at all. The overrides exist for pointing a client at a
 * deployment somewhere else.
 */

const env = import.meta.env as Record<string, string | undefined>;

export function signalingUrl(): string {
  const configured = env['VITE_SIGNALING_URL'];
  if (configured !== undefined && configured !== '') return configured;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws`;
}

export function apiBaseUrl(): string {
  return env['VITE_API_URL'] ?? location.origin;
}

/**
 * Pins ICE to relay only, which is how the TURN path is proved independently
 * of P2P — exit criterion 4 of the Phase 0.5 gate. A query parameter rather
 * than a build-time flag so it needs no rebuild to try.
 */
export function forceRelay(): boolean {
  return new URLSearchParams(location.search).get('relay') === '1';
}
