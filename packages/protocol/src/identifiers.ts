import {
  JOIN_CODE_LENGTH,
  JOIN_CODE_PATTERN,
  JOIN_TOKEN_PATTERN,
  SESSION_TIMEOUTS,
} from './constants.ts';

/**
 * Session identifier generation.
 *
 * Architecture §7 keeps three identifiers deliberately separate:
 *
 *   sessionId  internal UUID, never leaves the server
 *   joinCode   six digits — a LOOKUP KEY ONLY, granting nothing (ADR-0006)
 *   joinToken  128 bits, carried in the share link
 *
 * They live here rather than in the API service so that the rules are stated
 * once and tested once, and so the signaling service validates against the
 * same definitions the API generates from.
 */

/** Web Crypto, which exists in Node 20+, browsers and Electron alike. */
function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Six digits from a CSPRNG.
 *
 * Rejection sampling rather than `% 10`: bytes 250-255 would otherwise map to
 * digits 0-5 more often than the rest. The bias is small, but a join code is a
 * security boundary and there is no reason to accept a skewed one when
 * discarding six values in 256 costs nothing.
 */
export function generateJoinCode(): string {
  let code = '';
  while (code.length < JOIN_CODE_LENGTH) {
    for (const byte of randomBytes(JOIN_CODE_LENGTH)) {
      if (byte >= 250) continue;
      code += String(byte % 10);
      if (code.length === JOIN_CODE_LENGTH) break;
    }
  }
  return code;
}

/** 128 bits, base64url, no padding — 22 characters. */
export function generateJoinToken(): string {
  const bytes = randomBytes(16);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateSessionId(): string {
  return crypto.randomUUID();
}

export function isValidJoinCode(value: string): boolean {
  return JOIN_CODE_PATTERN.test(value);
}

export function isValidJoinToken(value: string): boolean {
  return JOIN_TOKEN_PATTERN.test(value);
}

/** Display form: `482 719`. Grouping is presentation only — never stored. */
export function formatJoinCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

/** Accepts what a person might type or paste: spaces, dashes, a pasted link. */
export function normaliseJoinCode(input: string): string {
  return input.replace(/[\s-]/g, '');
}

/**
 * Pull a join token out of a share link, or return the input if it already
 * looks like one. Returns null when neither.
 */
export function extractJoinToken(input: string): string | null {
  const trimmed = input.trim();
  if (isValidJoinToken(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    const last = url.pathname.split('/').filter(Boolean).at(-1);
    if (last !== undefined && isValidJoinToken(last)) return last;
  } catch {
    // Not a URL; fall through.
  }
  return null;
}

export interface SessionIdentifiers {
  sessionId: string;
  joinCode: string;
  joinToken: string;
  createdAt: number;
  expiresAt: number;
}

export function createSessionIdentifiers(now = Date.now()): SessionIdentifiers {
  return {
    sessionId: generateSessionId(),
    joinCode: generateJoinCode(),
    joinToken: generateJoinToken(),
    createdAt: now,
    expiresAt: now + SESSION_TIMEOUTS.maxLifetimeMs,
  };
}
