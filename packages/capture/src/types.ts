/**
 * The screen capture abstraction (architecture §6).
 *
 * The interface exists because the capture layer is the one part of this
 * product that genuinely cannot be cross-platform. What it must not become is
 * a lowest common denominator: platforms differ in ways users can see, and
 * pretending otherwise produces a UI that offers things that cannot work.
 *
 * `capabilities()` is how those differences reach the interface. **No
 * component may branch on platform directly** — it asks what this
 * implementation can do, and renders accordingly.
 */

/** Something that can be shared. Only meaningful where we draw our own picker. */
export interface CaptureSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  /** A still frame, as a data URL, where the platform can produce one. */
  thumbnail?: string;
}

export interface CaptureOptions {
  /** Ignored where the platform draws its own picker. */
  sourceId?: string;
  /** Requested, not guaranteed — see `PlatformCapabilities.systemAudio`. */
  systemAudio?: boolean;
  /**
   * Screen content by default. Turning this off asks the encoder to favour
   * smooth motion instead, which suits video playback and ruins spreadsheets
   * (architecture §9).
   */
  optimiseForText?: boolean;
}

export interface PlatformCapabilities {
  /**
   * Whether capture is possible here at all. False on every mobile browser:
   * `getDisplayMedia` does not exist on iOS Safari or Android Chrome, and
   * there is no workaround — mobile sharing needs a native app.
   */
  canShare: boolean;

  /**
   * Whether the platform draws the source picker itself.
   *
   * True in a browser, where `getDisplayMedia` opens the browser's own dialog
   * and ours would be a second, redundant step. True on Linux too, where the
   * portal picker belongs to the compositor. The UI must step aside rather
   * than compete.
   */
  platformPicker: boolean;

  /** Whether a single window can be shared, as opposed to a whole screen. */
  windowCapture: boolean;

  /**
   * System audio. Not uniform, and must never be offered where it cannot
   * work — see docs/platform-matrix.md. The control is disabled, not hidden,
   * so the absence is explained rather than mysterious.
   */
  systemAudio: boolean;

  /** For the UI to explain *why* something is unavailable. */
  reason?: string;
}

export interface ScreenCaptureManager {
  capabilities(): PlatformCapabilities;
  /** Empty where `platformPicker` is true — the platform is asking, not us. */
  listSources(): Promise<CaptureSource[]>;
  start(options?: CaptureOptions): Promise<MediaStream>;
  stop(): void;
  /** The live stream, or undefined when not sharing. */
  readonly stream: MediaStream | undefined;
}
