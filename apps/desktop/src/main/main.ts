import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { app, BrowserWindow, desktopCapturer, session } from 'electron';

import { RENDERER_ENTRY, registerRendererScheme, serveRendererFrom } from './renderer-protocol.ts';

/**
 * Electron main process — Phase 0.5.
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
      // No preload and no IPC are needed: setDisplayMediaRequestHandler lets
      // the renderer call getDisplayMedia() directly, so the renderer stays a
      // plain, fully isolated web page.
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

/**
 * Grant screen capture requests.
 *
 * Phase 0.5 picks the first screen automatically so the skeleton has no UI to
 * get in the way. **Phase 1 replaces this with the real source picker** — the
 * user must choose what to share, and choosing for them is not acceptable in a
 * shipped product.
 */
function installDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'], fetchWindowIcons: false })
        .then((sources) => {
          const [screen] = sources;
          if (screen === undefined) {
            // Denying with an empty object surfaces in the renderer as a
            // rejected promise, which is what the UI can act on.
            callback({});
            return;
          }
          console.info('[main] granting capture of', screen.name);
          callback({ video: screen });
        })
        .catch((err: unknown) => {
          console.error('[main] desktopCapturer failed', err);
          callback({});
        });
    },
    // Audio is out of scope until Phase 6, and is not uniformly available
    // across platforms anyway — see docs/platform-matrix.md.
    { useSystemPicker: false },
  );
}

// Must happen before the app is ready, or the scheme is not privileged and
// the renderer loses both its origin and its secure context.
registerRendererScheme();

void app.whenReady().then(() => {
  serveRendererFrom(join(here, '..', 'renderer'));
  installDisplayMediaHandler();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
