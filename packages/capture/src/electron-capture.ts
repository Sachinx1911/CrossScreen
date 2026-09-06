import { MEDIA_DEFAULTS } from '@crossscreen/protocol';

import { CaptureCancelled, CaptureRefused } from './browser-capture.ts';
import { detectCapabilities } from './detect.ts';
import type {
  CaptureOptions,
  CaptureSource,
  PlatformCapabilities,
  ScreenCaptureManager,
} from './types.ts';

/**
 * Capture in the Electron renderer.
 *
 * The difference from the browser is the picker. Here the sources are listed
 * with thumbnails and the choice is made in our own interface, which is most
 * of what the desktop app is *for* — the browser can only offer whatever
 * dialog it draws.
 *
 * The main process still performs the capture. This talks to it through the
 * two functions the preload exposes, and nothing else.
 */

/** What the preload puts on `window`. Kept narrow deliberately. */
interface CaptureBridge {
  listSources(): Promise<CaptureSource[]>;
  selectSource(sourceId: string): Promise<boolean>;
}

function bridge(): CaptureBridge | undefined {
  return (globalThis as { crossscreen?: CaptureBridge }).crossscreen;
}

/** Whether this is running inside the desktop shell. */
export function isElectron(): boolean {
  return bridge() !== undefined;
}

export class ElectronCapture implements ScreenCaptureManager {
  #stream: MediaStream | undefined;
  readonly #capabilities: PlatformCapabilities;

  constructor(userAgent: string = globalThis.navigator?.userAgent ?? '') {
    this.#capabilities = detectCapabilities({
      userAgent,
      hasGetDisplayMedia: typeof navigator.mediaDevices?.getDisplayMedia === 'function',
      isElectron: true,
    });
  }

  get stream(): MediaStream | undefined {
    return this.#stream;
  }

  capabilities(): PlatformCapabilities {
    return this.#capabilities;
  }

  async listSources(): Promise<CaptureSource[]> {
    const api = bridge();
    if (api === undefined) throw new CaptureRefused('Screen sharing is not available here');
    return api.listSources();
  }

  async start(options: CaptureOptions = {}): Promise<MediaStream> {
    const api = bridge();
    if (api === undefined) throw new CaptureRefused('Screen sharing is not available here');

    if (options.sourceId === undefined) {
      // Not a fallback to "the first screen". Choosing for someone is how a
      // private window ends up on a stranger's screen.
      throw new CaptureRefused('Choose what to share first');
    }

    await api.selectSource(options.sourceId);

    try {
      this.#stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { max: MEDIA_DEFAULTS.maxWidth },
          height: { max: MEDIA_DEFAULTS.maxHeight },
          frameRate: { max: MEDIA_DEFAULTS.maxFps },
        },
        audio: options.systemAudio === true && this.#capabilities.systemAudio,
      });
    } catch (err) {
      // The main process denies by resolving with nothing, which surfaces here
      // as a rejection — most often because the chosen window was closed
      // between picking it and starting.
      throw err instanceof Error && err.name === 'NotAllowedError'
        ? new CaptureCancelled()
        : new CaptureRefused('That screen or window could not be shared.');
    }

    const track = this.#stream.getVideoTracks()[0];
    if (track === undefined) {
      this.stop();
      throw new CaptureRefused('The screen share started without any video');
    }

    if (options.optimiseForText !== false) {
      track.contentHint = MEDIA_DEFAULTS.contentHint;
    }

    // The OS can end a capture without asking — a window closing, a display
    // being unplugged. Treat the track ending as authoritative.
    track.addEventListener('ended', () => {
      this.#stream = undefined;
    });

    return this.#stream;
  }

  stop(): void {
    this.#stream?.getTracks().forEach((track) => {
      track.stop();
    });
    this.#stream = undefined;
  }
}
