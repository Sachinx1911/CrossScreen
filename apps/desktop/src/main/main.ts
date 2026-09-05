import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { app, BrowserWindow, desktopCapturer, session } from 'electron';

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

  void window.loadFile(join(here, '..', 'renderer', 'index.html'));
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

void app.whenReady().then(() => {
  installDisplayMediaHandler();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
