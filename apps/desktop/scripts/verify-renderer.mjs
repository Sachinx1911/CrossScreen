/**
 * Verifies the renderer actually runs under its own Content-Security-Policy.
 *
 * Two failures during Phase 0.5 motivated this, and both were silent:
 *
 *  - A `script-src 'self'` policy on a `file://` page blocks the app's own
 *    bundle. No error, no console output; the window simply sits there.
 *  - `getDisplayMedia` is gated on a secure context. Serve the page from
 *    somewhere untrusted and `navigator.mediaDevices` is not merely empty,
 *    it is `undefined`.
 *
 * Both are invisible to typechecking and to unit tests, and both break the
 * entire product. Run: pnpm --filter @crossscreen/desktop verify:renderer
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';

import { installCaptureBridge } from '../dist/main/capture-bridge.js';
import {
  RENDERER_ENTRY,
  registerRendererScheme,
  serveRendererFrom,
} from '../dist/main/renderer-protocol.js';

const here = dirname(fileURLToPath(import.meta.url));
const rendererRoot = join(here, '..', 'dist', 'renderer');

const violations = [];

function fail(reason) {
  console.error(`FAIL: ${reason}`);
  app.exit(1);
}

registerRendererScheme();

app.whenReady().then(async () => {
  serveRendererFrom(rendererRoot);

  installCaptureBridge();

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(here, '..', 'dist', 'main', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.on('console-message', (event) => {
    const text = event.message;
    if (/Content Security Policy|Refused to (load|execute)/i.test(text)) {
      violations.push(text.split('\n')[0]);
    }
  });

  await win.loadURL(RENDERER_ENTRY);
  await new Promise((r) => setTimeout(r, 1500));

  const state = await win.webContents.executeJavaScript(`
    ({
      origin: location.origin,
      isSecureContext: window.isSecureContext,
      hasGetDisplayMedia: typeof navigator.mediaDevices?.getDisplayMedia === 'function',
    })
  `);

  // The bridge is the renderer's only route to the main process, and the
  // source picker is the entire reason the desktop app exists. If the preload
  // failed to load, `window.crossscreen` is simply absent and the picker sits
  // empty forever — with no error anywhere.
  const bridge = await win.webContents.executeJavaScript(`
    (async () => {
      if (window.crossscreen === undefined) return { present: false };
      const sources = await window.crossscreen.listSources();
      return {
        present: true,
        count: sources.length,
        screens: sources.filter((s) => s.kind === 'screen').length,
        hasThumbnails: sources.every((s) => typeof s.thumbnail === 'string' && s.thumbnail.length > 0),
        firstName: sources[0]?.name,
      };
    })()
  `);

  // The React app renders asynchronously; the picker heading only appears once
  // the bridge has answered.
  await new Promise((r) => setTimeout(r, 1200));
  const after = await win.webContents.executeJavaScript(`document.body.innerText`);

  console.log(`origin:            ${state.origin}`);
  console.log(`secure context:    ${state.isSecureContext}`);
  console.log(`getDisplayMedia:   ${state.hasGetDisplayMedia}`);
  console.log(`capture bridge:    ${bridge.present ? 'present' : 'MISSING'}`);
  console.log(`sources listed:    ${bridge.count ?? 0} (${bridge.screens ?? 0} screen)`);
  console.log(`thumbnails:        ${bridge.hasThumbnails ? 'yes' : 'no'}`);
  console.log(`CSP violations:    ${violations.length}`);
  for (const v of violations) console.log(`  - ${v}`);

  if (!state.isSecureContext) return fail('renderer is not a secure context');
  if (!state.hasGetDisplayMedia) return fail('navigator.mediaDevices.getDisplayMedia is missing');
  if (violations.length > 0) return fail('the page reported CSP violations');
  if (!bridge.present) return fail('window.crossscreen is missing — the preload did not load');
  if ((bridge.screens ?? 0) < 1) return fail('the picker found no screen to share');
  if (!bridge.hasThumbnails) return fail('sources have no thumbnails — the picker would be blind');
  if (!after.includes('CrossScreen')) {
    return fail('the renderer did not render — the bundle may not have executed');
  }

  console.log('');
  console.log('PASS: renderer, CSP, secure context and the capture bridge all hold.');
  app.exit(0);
});

setTimeout(() => fail('timed out'), 25_000);
