import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { protocol } from 'electron';

import { resolveWithin } from './resolve-path.ts';

/**
 * Serves the renderer over a custom `app://` scheme instead of `file://`.
 *
 * This exists for one reason: on a `file://` page, CSP `'self'` matches
 * nothing, so a correct `script-src 'self'` silently blocks the app's own
 * bundle and the window sits there doing nothing. Working around it by
 * allowing `file:` weakens the policy to the point of being decorative.
 *
 * A registered standard scheme has a real origin, so `'self'` means what it
 * says and the policy can be as tight as it should be.
 */

export const RENDERER_SCHEME = 'app';
export const RENDERER_ORIGIN = `${RENDERER_SCHEME}://bundle`;
export const RENDERER_ENTRY = `${RENDERER_ORIGIN}/index.html`;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Must run before `app.whenReady()`. `standard` gives the scheme an origin;
 * `secure` makes it a secure context, without which `getDisplayMedia` is not
 * even defined on `navigator.mediaDevices`.
 */
export function registerRendererScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: RENDERER_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);
}

export function serveRendererFrom(root: string): void {
  protocol.handle(RENDERER_SCHEME, async (request) => {
    const { pathname } = new URL(request.url);
    const file = resolveWithin(root, pathname);

    if (file === null) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const body = await readFile(file);
      const type = MIME_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
      return new Response(body, { headers: { 'content-type': type } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}
