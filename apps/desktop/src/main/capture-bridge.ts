import { desktopCapturer, ipcMain, session, type DesktopCapturerSource } from 'electron';

/**
 * The bridge between the renderer's source picker and Chromium's capture.
 *
 * Phase 0.5 granted the first screen automatically so the skeleton had no UI
 * in the way. That is not acceptable in a shipped product: choosing what to
 * share is the decision, and choosing it for someone is how a private window
 * ends up on a stranger's screen.
 *
 * The renderer asks for the list, shows it, and names what the user picked.
 * `setDisplayMediaRequestHandler` then resolves with that source — which is
 * what routes the request to Windows Graphics Capture, ScreenCaptureKit or the
 * PipeWire portal, depending on where it is running (ADR-0002).
 */

export const CAPTURE_CHANNELS = {
  list: 'capture:list-sources',
  select: 'capture:select-source',
} as const;

/** What the renderer picked, held between its choice and Chromium's request. */
let chosenSourceId: string | undefined;

export interface SerialisedSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  thumbnail: string;
}

function serialise(source: DesktopCapturerSource): SerialisedSource {
  return {
    id: source.id,
    name: source.name,
    kind: source.id.startsWith('screen:') ? 'screen' : 'window',
    // A data URL rather than a native image: the renderer is sandboxed and
    // cannot receive one, and a picker without previews asks people to choose
    // between "Screen 1" and "Screen 2" from memory.
    thumbnail: source.thumbnail.toDataURL(),
  };
}

export function installCaptureBridge(): void {
  ipcMain.handle(CAPTURE_CHANNELS.list, async (): Promise<SerialisedSource[]> => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false,
    });
    // Windows that cannot be captured produce empty thumbnails and log a
    // Graphics Capture error; offering them is offering a black rectangle.
    return sources.filter((s) => !s.thumbnail.isEmpty()).map(serialise);
  });

  ipcMain.handle(CAPTURE_CHANNELS.select, (_event, sourceId: unknown): boolean => {
    if (typeof sourceId !== 'string') return false;
    chosenSourceId = sourceId;
    return true;
  });

  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      const wanted = chosenSourceId;
      if (wanted === undefined) {
        // Nothing was chosen, so nothing is granted. Denying with an empty
        // object surfaces in the renderer as a rejected promise, which the UI
        // can act on — silently sharing something instead would be worse.
        callback({});
        return;
      }

      desktopCapturer
        .getSources({ types: ['screen', 'window'], fetchWindowIcons: false })
        .then((sources) => {
          const match = sources.find((s) => s.id === wanted);
          if (match === undefined) {
            // The window closed between choosing it and starting.
            callback({});
            return;
          }
          console.info('[main] granting capture of', match.name);
          callback({ video: match });
        })
        .catch((err: unknown) => {
          console.error('[main] desktopCapturer failed', err);
          callback({});
        })
        .finally(() => {
          // One grant per choice. Without this, a later request would silently
          // reuse a source the user chose for something else.
          chosenSourceId = undefined;
        });
    },
    { useSystemPicker: false },
  );
}
