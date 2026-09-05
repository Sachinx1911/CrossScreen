/**
 * Protocol-wide constants.
 *
 * Every value here is part of the contract between clients and the server.
 * Changing one is a protocol change: bump PROTOCOL_VERSION and write an ADR.
 */

/** Envelope version. Incremented only for breaking wire changes. */
export const PROTOCOL_VERSION = 1 as const;

/**
 * Session lifetimes, per ADR-0006. Short by design: an abandoned session is
 * an open door, and the product's sessions are inherently short-lived.
 */
export const SESSION_TIMEOUTS = {
  /** A created session nobody has joined. */
  unclaimedMs: 10 * 60 * 1_000,
  /** An active session that has dropped to zero participants. */
  idleMs: 5 * 60 * 1_000,
  /** Absolute ceiling regardless of activity. */
  maxLifetimeMs: 12 * 60 * 60 * 1_000,
  /** How long a pending join request waits before it is auto-rejected. */
  joinRequestMs: 60 * 1_000,
} as const;

/**
 * Rate limits that make the 6-digit join code safe (ADR-0006).
 * The code is a lookup key, never an access grant — these limits are what
 * stop it being enumerated.
 */
export const RATE_LIMITS = {
  codeAttemptsPerIpPerMinute: 5,
  codeAttemptsPerIpPerHour: 20,
  /** Failed attempts against one session before that session locks. */
  sessionLockThreshold: 10,
  sessionsPerIpPerHour: 20,
} as const;

/** Join code format: 6 digits, displayed grouped as "482 719". */
export const JOIN_CODE_LENGTH = 6;
export const JOIN_CODE_PATTERN = /^\d{6}$/;

/** Share-link token: 128 bits, base64url — 22 characters, no padding. */
export const JOIN_TOKEN_LENGTH = 22;
export const JOIN_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** WebSocket keepalive. Clients that miss two pongs are considered gone. */
export const HEARTBEAT = {
  intervalMs: 15_000,
  timeoutMs: 35_000,
} as const;

/** Guards against oversized SDP or malicious payloads. */
export const MAX_MESSAGE_BYTES = 64 * 1024;

/**
 * Media defaults for screen content (architecture §9).
 *
 * `maintain-resolution` is the load-bearing choice: under bandwidth pressure
 * we drop frame rate, never resolution. Blurry text is a failed session;
 * 8 fps legible text is a usable one.
 */
export const MEDIA_DEFAULTS = {
  contentHint: 'text',
  degradationPreference: 'maintain-resolution',
  codecPreference: ['VP9', 'H264', 'VP8'],
  maxWidth: 1920,
  maxHeight: 1080,
  minFps: 5,
  maxFps: 30,
} as const;
