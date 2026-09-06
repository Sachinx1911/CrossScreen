import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { app, BrowserWindow } from 'electron';

import { installCaptureBridge } from './capture-bridge.ts';
import { RENDERER_ENTRY, registerRendererScheme, serveRendererFrom } from './renderer-protocol.ts';

/**
 * Electron main process.
 *
 * This file is the whole reason ADR-0002 chose Electron over Tauri, so it is
 * worth being explicit about what it buys.
 *
 * `setDisplayMediaRequestHandler` is the bridge between the renderer's plain
 * `getDisplayMedia()` call and Chromium's own platform capture backends:
 * Windows Graphics Capture on Windows, ScreenCaptureKit on macOS 13+, and the
 * PipeWire/xdg-desktop-portal path on Wayland. Three native implementations,
 * maintained by Google, reached through one API.
 *
 * Tauri cannot do this: macOS WKWebView has no `getDisplayMedia` at all.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');

/**
 * Where the renderer should reach signaling, resolved at launch rather than
 * baked in at build time.
 *
 * `pnpm tunnel` writes the current tunnel URL to `.tunnel-url` at the
 * repository root. Reading it here means the cross-network test is "start the
 * tunnel, start the app" instead of editing a file and rebuilding every time
 * cloudflared hands out a new hostname.
 */
function signalingOverride(): string | undefined {
  const fromEnv = process.env['CROSSSCREEN_SIGNALING_URL'];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;

  try {
    const url = readFileSync(join(repoRoot, '.tunnel-url'), 'utf8').trim();
    return url === '' ? undefined : url;
  } catch {
    return undefined;
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 900,
    height: 640,
    backgroundColor: '#0b0d10',
    title: 'CrossScreen',
    webPreferences: {
      // The preload is the renderer's only route to the main process, and it
      // exposes exactly two functions taking plain data. Everything else stays
      // shut: no Node, no require, full context isolation.
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Forward renderer console output to the terminal. Without this the stats
  // lines the Phase 0.5 gate is read from are only visible in devtools, which
  // makes any scripted or headless run blind.
  window.webContents.on('console-message', (event) => {
    const prefix = event.level === 'error' ? '[renderer:error]' : '[renderer]';
    console.log(prefix, event.message);
  });

  const signaling = signalingOverride();
  if (signaling !== undefined) {
    console.info('[main] signaling override:', signaling);
  }

  const entry =
    signaling === undefined
      ? RENDERER_ENTRY
      : `${RENDERER_ENTRY}?signaling=${encodeURIComponent(signaling)}`;

  void window.loadURL(entry);
  return window;
}

registerRendererScheme();

void app.whenReady().then(() => {
  serveRendererFrom(join(here, '..', 'renderer'));
  installCaptureBridge();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
