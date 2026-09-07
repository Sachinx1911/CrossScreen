/**
 * Where the services are, for the desktop app.
 *
 * Unlike the web app there is no origin to fall back to — the renderer is
 * served from `app://bundle` — so these always have to be resolved. The main
 * process passes an override as a query parameter when `.tunnel-url` exists,
 * which is what makes the cross-network test need no rebuild.
 */

const env = import.meta.env as Record<string, string | undefined>;

function fromQuery(name: string): string | undefined {
  const value = new URLSearchParams(location.search).get(name);
  return value === null || value === '' ? undefined : value;
}

export function signalingUrl(): string {
  return fromQuery('signaling') ?? env['VITE_SIGNALING_URL'] ?? 'ws://127.0.0.1:8787';
}

export function apiBaseUrl(): string {
  return fromQuery('api') ?? env['VITE_API_URL'] ?? 'http://127.0.0.1:8788';
}

/**
 * Pins ICE to relay only. A build-time flag rather than a query parameter
 * here — unlike the web app, this window is not reached by navigating to a
 * fresh URL, so there is no link to append `?relay=1` to. Set
 * `VITE_FORCE_RELAY=1` and restart. Each session refuses to start rather than
 * fail silently if no TURN server is configured.
 */
export function forceRelay(): boolean {
  return env['VITE_FORCE_RELAY'] === '1';
}

/** Where errors go (phase-2-reliability.md §2.6). `undefined` turns reporting off. */
export function sentryDsn(): string | undefined {
  const configured = env['VITE_SENTRY_DSN'];
  return configured === undefined || configured === '' ? undefined : configured;
}
