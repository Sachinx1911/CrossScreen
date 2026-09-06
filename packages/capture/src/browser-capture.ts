import { MEDIA_DEFAULTS } from '@crossscreen/protocol';

import { currentEnvironment, detectCapabilities, type Environment } from './detect.ts';
import type {
  CaptureOptions,
  CaptureSource,
  PlatformCapabilities,
  ScreenCaptureManager,
} from './types.ts';

/**
 * Capture in a browser tab, via `getDisplayMedia`.
 *
 * The primary sharing path for v1 (ADR-0010): no download, no install, no code
 * signing, and it reaches Windows, macOS and Linux at once.
 *
 * The browser owns the source picker, so this implementation has none. That is
 * a constraint worth respecting rather than working around — a second dialog
 * of our own before the browser's would be two steps to do one thing.
 */

/** Thrown when the user dismisses the browser's picker. Not an error state. */
export class CaptureCancelled extends Error {
  constructor() {
    super('The screen share was cancelled');
    this.name = 'CaptureCancelled';
  }
}

/** Thrown when the browser or the OS refuses. */
export class CaptureRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaptureRefused';
  }
}

export class BrowserCapture implements ScreenCaptureManager {
  #stream: MediaStream | undefined;
  readonly #capabilities: PlatformCapabilities;

  constructor(environment: Environment = currentEnvironment()) {
    this.#capabilities = detectCapabilities(environment);
  }

  get stream(): MediaStream | undefined {
    return this.#stream;
  }

  capabilities(): PlatformCapabilities {
    return this.#capabilities;
  }

  /** Always empty: the browser asks the question, not us. */
  listSources(): Promise<CaptureSource[]> {
    return Promise.resolve([]);
  }

  async start(options: CaptureOptions = {}): Promise<MediaStream> {
    if (!this.#capabilities.canShare) {
      throw new CaptureRefused(this.#capabilities.reason ?? 'Screen sharing is not available here');
    }

    // Only ask for audio where it can be delivered. Requesting it in Firefox
    // is not merely ignored — it can make the whole call fail.
    const wantsAudio = options.systemAudio === true && this.#capabilities.systemAudio;

    try {
      this.#stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          // `max` only, never `ideal`: a screen already smaller than the
          // ceiling is left alone. "Never upscale", as architecture §9 puts it.
          width: { max: MEDIA_DEFAULTS.maxWidth },
          height: { max: MEDIA_DEFAULTS.maxHeight },
          frameRate: { max: MEDIA_DEFAULTS.maxFps },
        },
        audio: wantsAudio,
      });
    } catch (err) {
      throw translate(err);
    }

    const track = this.#stream.getVideoTracks()[0];
    if (track === undefined) {
      this.stop();
      throw new CaptureRefused('The screen share started without any video');
    }

    if (options.optimiseForText !== false) {
      track.contentHint = MEDIA_DEFAULTS.contentHint;
    }

    // The browser's own "Stop sharing" bar ends the track without telling us,
    // and so does the OS. Treat the track ending as authoritative rather than
    // assuming we are still sharing.
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

/**
 * Turn a DOMException into something a person can act on.
 *
 * Dismissing the picker throws `NotAllowedError` — the same name a genuine
 * permission block uses — so the two are indistinguishable by name alone. They
 * are separated here because they need completely different UI: one is the
 * user changing their mind, the other is something they have to go and fix.
 */
function translate(err: unknown): Error {
  if (!(err instanceof Error)) return new CaptureRefused('Screen sharing could not be started');

  switch (err.name) {
    case 'NotAllowedError':
      // A dismissal comes back almost instantly and carries no message;
      // a policy block usually explains itself. Imperfect, and the reason the
      // UI treats cancellation as the harmless default.
      return err.message === '' || /Permission denied by user/i.test(err.message)
        ? new CaptureCancelled()
        : new CaptureRefused(
            'Your browser or system is blocking screen sharing. Check its permissions and try again.',
          );

    case 'NotFoundError':
      return new CaptureRefused('No screen was available to share.');

    case 'NotReadableError':
      return new CaptureRefused(
        'Your system would not let the screen be read. Another app may be using it.',
      );

    case 'AbortError':
      return new CaptureCancelled();

    default:
      return new CaptureRefused('Screen sharing could not be started.');
  }
}
