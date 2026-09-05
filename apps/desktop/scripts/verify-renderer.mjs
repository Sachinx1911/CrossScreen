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

  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
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
      hasMediaDevices: navigator.mediaDevices !== undefined,
      hasGetDisplayMedia: typeof navigator.mediaDevices?.getDisplayMedia === 'function',
      status: document.querySelector('#status')?.textContent,
    })
  `);

  // Clicking Start Sharing is the only way to tell whether the bundle actually
  // executed: a blocked script leaves a page that looks entirely normal.
  await win.webContents.executeJavaScript(`document.querySelector('#share').click(); true`);
  await new Promise((r) => setTimeout(r, 1200));
  const after = await win.webContents.executeJavaScript(
    `document.querySelector('#status').textContent`,
  );

  console.log(`origin:              ${state.origin}`);
  console.log(`secure context:      ${state.isSecureContext}`);
  console.log(`getDisplayMedia:     ${state.hasGetDisplayMedia}`);
  console.log(`status before click: ${state.status}`);
  console.log(`status after click:  ${after}`);
  console.log(`CSP violations:      ${violations.length}`);
  for (const v of violations) console.log(`  - ${v}`);

  if (!state.isSecureContext) return fail('renderer is not a secure context');
  if (!state.hasGetDisplayMedia) return fail('navigator.mediaDevices.getDisplayMedia is missing');
  if (violations.length > 0) return fail('the page reported CSP violations');
  if (after === state.status) {
    return fail('clicking Start Sharing changed nothing — the bundle did not execute');
  }

  console.log('');
  console.log('PASS: the renderer runs under its own CSP, in a secure context.');
  app.exit(0);
});

setTimeout(() => fail('timed out'), 25_000);
