import { z } from 'zod';
import { PROTOCOL_VERSION } from './constants.ts';
import { ERROR_CODES } from './errors.ts';
import {
  connectionQualitySchema,
  connectionStateSchema,
  joinCodeSchema,
  joinRequestInfoSchema,
  joinTokenSchema,
  participantSchema,
  sessionSummarySchema,
} from './session.ts';

/**
 * The signaling protocol.
 *
 * Plain JSON over WSS (ADR-0008), because every client platform — TypeScript
 * today, Kotlin next, Swift later — can implement a plain WebSocket without a
 * vendor library, and because a human-readable wire format is worth a great
 * deal when debugging signaling across five platforms.
 *
 * Envelope: { v, id, ts, payload }
 *   v    protocol version; a mismatch is refused, never guessed at
 *   id   sender-generated, echoed on a direct reply so the two can be paired
 *   ts   sender's clock, for latency measurement only — never for logic
 *
 * The message `type` lives in the payload, not beside it. This description
 * said otherwise for a while, which matters more here than in most comments:
 * the Kotlin and Swift clients are generated from `schema/`, so they were
 * never at risk, but a person implementing against the prose would have added
 * a field the server does not send and does not accept.
 *
 * A reply carries the request's `id` as its own envelope id. Errors are the
 * exception — an error can arrive with no request behind it, so the pairing
 * moves into the payload as `inReplyTo` and is simply absent when there is
 * nothing to point at.
 */

// --------------------------------------------------------------------------
// Client -> Server
// --------------------------------------------------------------------------

export const clientMessageSchema = z.discriminatedUnion('type', [
  /** Host attaches to a session it created over the HTTP API. */
  z.object({
    type: z.literal('session.host.attach'),
    hostToken: z.string(),
  }),

  /**
   * Viewer asks to join. This does NOT grant access: the server places the
   * viewer in `pending` and notifies the host. No SDP is exchanged until the
   * host approves (ADR-0006).
   */
  z
    .object({
      type: z.literal('session.viewer.request'),
      joinCode: joinCodeSchema.optional(),
      joinToken: joinTokenSchema.optional(),
    })
    .refine((v) => v.joinCode !== undefined || v.joinToken !== undefined, {
      message: 'A join request must carry either a joinCode or a joinToken',
    }),

  /** Host's decision on a pending viewer. Host-only; server enforces. */
  z.object({
    type: z.literal('session.viewer.approve'),
    participantId: z.uuid(),
  }),
  z.object({
    type: z.literal('session.viewer.reject'),
    participantId: z.uuid(),
  }),

  /** Host ends the session for everyone. */
  z.object({ type: z.literal('session.end') }),

  // --- WebRTC negotiation. Relayed verbatim; the server never inspects SDP. ---
  z.object({
    type: z.literal('rtc.offer'),
    to: z.uuid(),
    sdp: z.string(),
  }),
  z.object({
    type: z.literal('rtc.answer'),
    to: z.uuid(),
    sdp: z.string(),
  }),
  z.object({
    type: z.literal('rtc.ice'),
    to: z.uuid(),
    candidate: z.string(),
    sdpMid: z.string().nullable(),
    sdpMLineIndex: z.number().int().nullable(),
  }),
  /** Request an ICE restart after a network change. */
  z.object({
    type: z.literal('rtc.restart'),
    to: z.uuid(),
  }),

  /**
   * Periodic connection telemetry. Drives the quality indicator and, more
   * importantly, the P2P-versus-relay ratio that predicts TURN cost (ADR-0004).
   */
  z.object({
    type: z.literal('stats.report'),
    quality: connectionQualitySchema,
    connectionState: connectionStateSchema,
    /** Whether media is flowing directly or through a TURN relay. */
    transport: z.enum(['direct', 'relay', 'unknown']),
    roundTripMs: z.number().nonnegative().optional(),
    packetLossPct: z.number().min(0).max(100).optional(),
    bitrateKbps: z.number().nonnegative().optional(),
    framesPerSecond: z.number().nonnegative().optional(),
    resolution: z.string().max(16).optional(),
    codec: z.string().max(24).optional(),
  }),

  z.object({ type: z.literal('ping') }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// --------------------------------------------------------------------------
// Server -> Client
// --------------------------------------------------------------------------

export const serverMessageSchema = z.discriminatedUnion('type', [
  /** Full session state; sent on attach and after any membership change. */
  z.object({
    type: z.literal('session.state'),
    session: sessionSummarySchema,
    /** The recipient's own participant id. */
    you: z.uuid(),
  }),

  /** To the host: someone is waiting. Carries what the host needs to decide. */
  z.object({
    type: z.literal('session.viewer.pending'),
    request: joinRequestInfoSchema,
  }),

  /** To the viewer: the host's answer. */
  z.object({
    type: z.literal('session.viewer.approved'),
    participantId: z.uuid(),
    /** Scoped to one session and one connection; issued only after approval. */
    participantToken: z.string(),
  }),
  z.object({ type: z.literal('session.viewer.rejected') }),

  z.object({ type: z.literal('peer.joined'), participant: participantSchema }),
  z.object({ type: z.literal('peer.left'), participantId: z.uuid() }),

  z.object({
    type: z.literal('session.ended'),
    reason: z.enum(['host_ended', 'expired', 'idle_timeout']),
  }),

  // --- Relayed negotiation, with `from` filled in by the server ---
  z.object({
    type: z.literal('rtc.offer'),
    from: z.uuid(),
    sdp: z.string(),
  }),
  z.object({
    type: z.literal('rtc.answer'),
    from: z.uuid(),
    sdp: z.string(),
  }),
  z.object({
    type: z.literal('rtc.ice'),
    from: z.uuid(),
    candidate: z.string(),
    sdpMid: z.string().nullable(),
    sdpMLineIndex: z.number().int().nullable(),
  }),
  z.object({ type: z.literal('rtc.restart'), from: z.uuid() }),

  /**
   * Errors always carry both a machine code and text fit to display.
   * `retryable` saves each client from re-deriving retry policy.
   */
  z.object({
    type: z.literal('error'),
    code: z.enum(ERROR_CODES),
    userMessage: z.string(),
    retryable: z.boolean(),
    /** Correlates with the `id` of the message that caused it, when there was one. */
    inReplyTo: z.string().optional(),
  }),

  z.object({ type: z.literal('pong') }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

// --------------------------------------------------------------------------
// Envelope
// --------------------------------------------------------------------------

const envelopeBase = {
  v: z.literal(PROTOCOL_VERSION),
  id: z.string().min(1).max(64),
  ts: z.number().int(),
};

export const clientEnvelopeSchema = z.object({
  ...envelopeBase,
  payload: clientMessageSchema,
});
export type ClientEnvelope = z.infer<typeof clientEnvelopeSchema>;

export const serverEnvelopeSchema = z.object({
  ...envelopeBase,
  payload: serverMessageSchema,
});
export type ServerEnvelope = z.infer<typeof serverEnvelopeSchema>;

/** Convenience: message `type` string unions, useful for exhaustive switches. */
export type ClientMessageType = ClientMessage['type'];
export type ServerMessageType = ServerMessage['type'];
