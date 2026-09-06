import type { PlatformCapabilities } from './types.ts';

/**
 * What this environment can actually do.
 *
 * Pure, and separated from the capture code on purpose: it encodes the
 * platform matrix, which is the part most likely to be wrong and the part
 * whose being wrong is least visible. A UI that offers system audio where it
 * cannot work looks broken; one that hides sharing where it would have worked
 * loses the user entirely.
 */

export interface Environment {
  userAgent: string;
  /** Whether `navigator.mediaDevices.getDisplayMedia` exists. */
  hasGetDisplayMedia: boolean;
  /** Set by the Electron shell, which has capabilities a browser does not. */
  isElectron?: boolean;
}

function isMobile(userAgent: string): boolean {
  // iPadOS reports itself as a Mac, so "Macintosh" with touch points is an
  // iPad. Without that check an iPad is told it can share, and then cannot.
  return /iPhone|iPad|iPod|Android/i.test(userAgent);
}

function isFirefox(userAgent: string): boolean {
  return userAgent.includes('Firefox/');
}

function isSafari(userAgent: string): boolean {
  return userAgent.includes('Safari/') && !/Chrome\/|Chromium\/|Edg\//.test(userAgent);
}

function isWindows(userAgent: string): boolean {
  return /Windows/i.test(userAgent);
}

export function detectCapabilities(env: Environment): PlatformCapabilities {
  const { userAgent, hasGetDisplayMedia } = env;

  if (isMobile(userAgent)) {
    return {
      canShare: false,
      platformPicker: false,
      windowCapture: false,
      systemAudio: false,
      reason:
        'Phones and tablets cannot share a screen from a browser. You can watch a screen here, and share from a computer.',
    };
  }

  if (!hasGetDisplayMedia) {
    return {
      canShare: false,
      platformPicker: false,
      windowCapture: false,
      systemAudio: false,
      reason: 'This browser cannot share a screen. Chrome, Edge or Firefox can.',
    };
  }

  if (env.isElectron === true) {
    // The desktop app reaches Chromium's native backends directly, so it can
    // draw its own picker and offer whole-screen capture without a dialog.
    return {
      canShare: true,
      platformPicker: false,
      windowCapture: true,
      // Windows first, per Phase 6. Elsewhere the capability exists but has
      // not been verified, and offering it unverified is how a feature becomes
      // a support burden.
      systemAudio: isWindows(userAgent),
    };
  }

  return {
    canShare: true,
    // The browser opens its own dialog; ours would be a redundant second step.
    platformPicker: true,
    windowCapture: true,
    // Firefox does not implement system audio in getDisplayMedia at all, and
    // Safari's screen-share behaviour is the least consistent of the four.
    systemAudio: !isFirefox(userAgent) && !isSafari(userAgent),
    ...(isSafari(userAgent)
      ? { reason: 'Safari support is best-effort. Chrome, Edge or Firefox are more reliable.' }
      : {}),
  };
}

/** Read the environment from the current browser. */
export function currentEnvironment(): Environment {
  const nav = globalThis.navigator as Navigator | undefined;
  return {
    userAgent: nav?.userAgent ?? '',
    hasGetDisplayMedia: typeof nav?.mediaDevices?.getDisplayMedia === 'function',
  };
}
