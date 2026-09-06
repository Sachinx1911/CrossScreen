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
