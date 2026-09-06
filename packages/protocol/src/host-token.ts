import { z } from 'zod';

import { joinCodeSchema, joinTokenSchema } from './session.ts';

/**
 * The host token.
 *
 * A compact JWT (HS256) carrying everything `signaling` needs to recognise a
 * session that `api` created, so the two processes share a secret rather than
 * a database (ADR-0011).
 *
 * Written by hand against Web Crypto rather than pulled from a library. The
 * whole of it is one signature over one JSON object; a dependency here would
 * be more surface than substance, and the shape has to be identical in the
 * Kotlin and Swift clients later.
 *
 * **What this token proves is authorship of a session — nothing else.** It
 * never says a viewer may watch: that still requires host approval, and no SDP
 * is relayed before it (ADR-0006).
 */

export const hostTokenClaimsSchema = z.object({
  /** Internal session id. Never exposed to a viewer. */
  sid: z.uuid(),
  code: joinCodeSchema,
  tok: joinTokenSchema,
  /** Issued at, seconds since epoch — JWT convention, not milliseconds. */
  iat: z.number().int(),
  /** Expiry, seconds since epoch. */
  exp: z.number().int(),
});
export type HostTokenClaims = z.infer<typeof hostTokenClaimsSchema>;

const HEADER = { alg: 'HS256', typ: 'JWT' } as const;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

// Return type inferred on purpose. Naming it would mean `CryptoKey`, which
// lives in the DOM lib — and this package is imported by the Node services as
// well as the browser, so widening its lib to reach one type would let DOM
// APIs slip into code that has no DOM.
async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signHostToken(claims: HostTokenClaims, secret: string): Promise<string> {
  const body = `${base64url(encoder.encode(JSON.stringify(HEADER)))}.${base64url(
    encoder.encode(JSON.stringify(claims)),
  )}`;
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
  return `${body}.${base64url(new Uint8Array(signature))}`;
}

export type HostTokenResult =
  | { ok: true; claims: HostTokenClaims }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'bad_claims' };

/**
 * Verify and decode.
 *
 * The signature is checked **before** the claims are parsed and before expiry
 * is considered, so an attacker learns nothing from the ordering — every
 * unsigned token fails the same way regardless of what it claims.
 */
export async function verifyHostToken(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<HostTokenResult> {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [header, payload, signature] = parts as [string, string, string];

  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      fromBase64url(signature),
      encoder.encode(`${header}.${payload}`),
    );
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!valid) return { ok: false, reason: 'bad_signature' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(fromBase64url(payload)));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const claims = hostTokenClaimsSchema.safeParse(parsed);
  if (!claims.success) return { ok: false, reason: 'bad_claims' };
  if (claims.data.exp * 1000 <= now) return { ok: false, reason: 'expired' };

  return { ok: true, claims: claims.data };
}
