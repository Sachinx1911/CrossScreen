/**
 * Error codes.
 *
 * Architecture §66: a user must never see "ICE failed". Every error therefore
 * carries a machine-readable `code` for logs and metrics, and a `userMessage`
 * written in plain language for the interface.
 *
 * The user-facing strings live here rather than in each client so that all
 * five platforms say the same thing.
 */

export const ERROR_CODES = [
  // --- Session lookup and lifecycle ---
  'SESSION_NOT_FOUND',
  'SESSION_EXPIRED',
  'SESSION_ENDED_BY_HOST',
  'SESSION_FULL',
  'SESSION_LOCKED',

  // --- Authorisation ---
  'JOIN_REJECTED',
  'JOIN_REQUEST_TIMED_OUT',
  'INVALID_TOKEN',
  'TOKEN_EXPIRED',
  'NOT_SESSION_HOST',

  // --- Rate limiting and abuse ---
  'RATE_LIMITED',
  'TOO_MANY_SESSIONS',

  // --- Connection ---
  'CONNECTION_FAILED',
  'CONNECTION_LOST',
  'SIGNALING_UNAVAILABLE',

  // --- Capture ---
  'CAPTURE_PERMISSION_DENIED',
  'CAPTURE_UNAVAILABLE',
  'CAPTURE_STOPPED_BY_SYSTEM',

  // --- Protocol ---
  'MALFORMED_MESSAGE',
  'UNSUPPORTED_PROTOCOL_VERSION',
  'MESSAGE_TOO_LARGE',

  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Plain-language text for each code. No jargon, no blame, and where possible
 * a next step. These are shown verbatim to end users.
 */
export const USER_MESSAGES: Record<ErrorCode, string> = {
  SESSION_NOT_FOUND: "We couldn't find that session. Check the code and try again.",
  SESSION_EXPIRED: 'This session has expired. Ask for a new link or code.',
  SESSION_ENDED_BY_HOST: 'The host ended the session.',
  SESSION_FULL: 'This session is already full.',
  SESSION_LOCKED:
    'This session is locked after too many failed attempts. Ask the host for a new code.',

  JOIN_REJECTED: 'The host declined your request to join.',
  JOIN_REQUEST_TIMED_OUT: "The host didn't respond. You can try again.",
  INVALID_TOKEN: "That link doesn't look right. Ask for a new one.",
  TOKEN_EXPIRED: 'Your access to this session has expired. Try joining again.',
  NOT_SESSION_HOST: 'Only the host can do that.',

  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  TOO_MANY_SESSIONS:
    "You've started a lot of sessions recently. Please wait before starting another.",

  CONNECTION_FAILED: "We couldn't connect. This is usually a network or firewall restriction.",
  CONNECTION_LOST: 'Connection lost. Reconnecting…',
  SIGNALING_UNAVAILABLE: "CrossScreen is temporarily unreachable. We're on it.",

  CAPTURE_PERMISSION_DENIED:
    'CrossScreen needs permission to record your screen. You can grant it in your system settings.',
  CAPTURE_UNAVAILABLE: "Screen sharing isn't available on this device yet.",
  CAPTURE_STOPPED_BY_SYSTEM: 'Your device stopped the screen share.',

  MALFORMED_MESSAGE: 'Something went wrong. Please try again.',
  UNSUPPORTED_PROTOCOL_VERSION:
    'Your version of CrossScreen is out of date. Please update to continue.',
  MESSAGE_TOO_LARGE: 'Something went wrong. Please try again.',

  INTERNAL_ERROR: 'Something went wrong on our side. Please try again.',
};

/**
 * Whether the client should retry on its own. Used by the reconnection logic
 * so that retry policy is defined once, next to the codes it applies to.
 */
export const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'CONNECTION_LOST',
  'SIGNALING_UNAVAILABLE',
  'INTERNAL_ERROR',
]);

export function userMessageFor(code: ErrorCode): string {
  return USER_MESSAGES[code];
}

export function isRetryable(code: ErrorCode): boolean {
  return RETRYABLE.has(code);
}
