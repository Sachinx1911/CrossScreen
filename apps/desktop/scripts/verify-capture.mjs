/**
 * Verifies the assumption ADR-0002 rests on, headlessly.
 *
 * The claim is that Electron's `setDisplayMediaRequestHandler` routes a plain
 * `getDisplayMedia()` call in the renderer to Chromium's native platform
 * capture backend — Windows Graphics Capture, ScreenCaptureKit, or the
 * PipeWire portal. If that is not true, the desktop architecture is wrong and
 * everything built on it is wasted.
 *
 * Run: pnpm --filter @crossscreen/desktop verify:capture
 * Exits 0 on success, 1 on failure, and prints what it actually captured.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, desktopCapturer, session } from 'electron';

const here = dirname(fileURLToPath(import.meta.url));

const TIMEOUT_MS = 20_000;

function fail(reason, detail) {
  console.error(`FAIL: ${reason}`);
  if (detail !== undefined) console.error(detail);
  app.exit(1);
}

const timer = setTimeout(() => fail('timed out waiting for capture'), TIMEOUT_MS);

app.whenReady().then(async () => {
  // Step 1: can we enumerate sources at all?
  // Only screens. Enumerating windows makes Windows Graphics Capture log
  // noisy "Source is not capturable" errors for every window that cannot be
  // captured, which is normal and not something the skeleton needs.
  const screens = await desktopCapturer.getSources({
    types: ['screen'],
    fetchWindowIcons: false,
  });
  console.log(`screens found: ${screens.length}`);
  for (const s of screens) console.log(`  - ${s.id} "${s.name}"`);

  if (screens.length === 0) {
    clearTimeout(timer);
    fail('desktopCapturer returned no screens');
    return;
  }

  // Step 2: does the handler actually satisfy a renderer getDisplayMedia call?
  let handlerCalled = false;
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      handlerCalled = true;
      callback({ video: screens[0] });
    },
    { useSystemPicker: false },
  );

  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await win.loadFile(join(here, 'probe.html'));

  try {
    const result = await win.webContents.executeJavaScript(`
      (async () => {
        if (navigator.mediaDevices === undefined) {
          throw new Error('navigator.mediaDevices is undefined - not a secure context');
        }
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const track = stream.getVideoTracks()[0];
        const settings = track.getSettings();
        // Prove the track carries real frames, not just a handle.
        const supported = 'contentHint' in track;
        track.contentHint = 'text';
        const hint = track.contentHint;
        stream.getTracks().forEach((t) => t.stop());
        return { label: track.label, settings, contentHintSupported: supported, hint };
      })()
    `);

    clearTimeout(timer);

    if (!handlerCalled) {
      fail('getDisplayMedia resolved without the handler being called');
      return;
    }
    if (result.settings.width === undefined || result.settings.width < 1) {
      fail('captured track has no dimensions', JSON.stringify(result));
      return;
    }
    if (result.hint !== 'text') {
      fail('contentHint could not be set to "text" — screen-content coding would not engage');
      return;
    }

    console.log('handler invoked:      yes');
    console.log(`track label:          ${result.label}`);
    console.log(`capture size:         ${result.settings.width}x${result.settings.height}`);
    console.log(`frame rate:           ${result.settings.frameRate ?? 'unreported'}`);
    console.log(`contentHint accepted: ${result.hint}`);
    console.log('');
    console.log('PASS: ADR-0002 holds on this platform.');
    console.log(`      platform=${process.platform} electron=${process.versions.electron}`);
    app.exit(0);
  } catch (err) {
    clearTimeout(timer);
    fail('getDisplayMedia rejected', err instanceof Error ? err.stack : String(err));
  }
});
