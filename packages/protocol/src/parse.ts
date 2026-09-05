import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION } from './constants.ts';
import { type ErrorCode, userMessageFor, isRetryable } from './errors.ts';
import {
  clientEnvelopeSchema,
  serverEnvelopeSchema,
  type ClientEnvelope,
  type ClientMessage,
  type ServerEnvelope,
  type ServerMessage,
} from './messages.ts';

/**
 * Wire parsing and construction.
 *
 * Every inbound frame is untrusted. Nothing reaches business logic without
 * passing through here, which is also where the size cap and version check
 * live so no call site can forget them.
 */

export type ParseResult<T> =
  { ok: true; value: T } | { ok: false; code: ErrorCode; detail: string };

function parseEnvelope<T>(
  raw: string | Uint8Array,
  schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: unknown } },
): ParseResult<T> {
  const byteLength = typeof raw === 'string' ? Buffer.byteLength(raw, 'utf8') : raw.byteLength;
  if (byteLength > MAX_MESSAGE_BYTES) {
    return { ok: false, code: 'MESSAGE_TOO_LARGE', detail: `${byteLength} bytes` };
  }

  let json: unknown;
  try {
    json = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8'));
  } catch {
    return { ok: false, code: 'MALFORMED_MESSAGE', detail: 'not valid JSON' };
  }

  // Check the version before the shape, so an old client gets "please update"
  // rather than a confusing validation failure.
  if (typeof json === 'object' && json !== null && 'v' in json) {
    const v = (json as { v: unknown }).v;
    if (v !== PROTOCOL_VERSION) {
      return {
        ok: false,
        code: 'UNSUPPORTED_PROTOCOL_VERSION',
        detail: `got ${String(v)}, expected ${PROTOCOL_VERSION}`,
      };
    }
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    return { ok: false, code: 'MALFORMED_MESSAGE', detail: String(result.error) };
  }
  return { ok: true, value: result.data as T };
}

export function parseClientEnvelope(raw: string | Uint8Array): ParseResult<ClientEnvelope> {
  return parseEnvelope<ClientEnvelope>(raw, clientEnvelopeSchema);
}

export function parseServerEnvelope(raw: string | Uint8Array): ParseResult<ServerEnvelope> {
  return parseEnvelope<ServerEnvelope>(raw, serverEnvelopeSchema);
}

let counter = 0;
/** Message ids only need to be unique per connection, not globally. */
function nextId(): string {
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER;
  return `${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function envelope<T extends ClientMessage | ServerMessage>(
  payload: T,
  id: string = nextId(),
): { v: typeof PROTOCOL_VERSION; id: string; ts: number; payload: T } {
  return { v: PROTOCOL_VERSION, id, ts: Date.now(), payload };
}

/**
 * Build an error frame. Centralised so that the user-facing text and the
 * retry policy always travel together with the code.
 */
export function errorMessage(code: ErrorCode, inReplyTo?: string): ServerMessage {
  return {
    type: 'error',
    code,
    userMessage: userMessageFor(code),
    retryable: isRetryable(code),
    ...(inReplyTo === undefined ? {} : { inReplyTo }),
  };
}
