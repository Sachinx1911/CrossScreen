import { z } from 'zod';
import { JOIN_CODE_PATTERN, JOIN_TOKEN_PATTERN } from './constants.ts';

/**
 * Session and participant shapes.
 *
 * Note the deliberate split between identifiers (architecture §7):
 *   sessionId  internal UUID, never leaves the server
 *   joinCode   6 digits, a LOOKUP KEY ONLY — it grants nothing (ADR-0006)
 *   joinToken  128-bit, carried in the share link
 * A viewer holding either one still lands in `pending` until the host approves.
 */

export const joinCodeSchema = z
  .string()
  .regex(JOIN_CODE_PATTERN, 'Join code must be exactly 6 digits');

export const joinTokenSchema = z
  .string()
  .regex(JOIN_TOKEN_PATTERN, 'Join token must be 22 base64url characters');

export const sessionStateSchema = z.enum([
  /** Created; nobody has joined yet. */
  'waiting',
  /** At least one approved viewer is connected. */
  'active',
  /** Host stopped sharing, or the session timed out. */
  'ended',
  'expired',
]);
export type SessionState = z.infer<typeof sessionStateSchema>;

export const participantRoleSchema = z.enum(['host', 'viewer']);
export type ParticipantRole = z.infer<typeof participantRoleSchema>;

export const participantStateSchema = z.enum([
  /** Requested access; waiting on the host. No SDP has been exchanged. */
  'pending',
  'approved',
  'rejected',
  'connected',
  'disconnected',
]);
export type ParticipantState = z.infer<typeof participantStateSchema>;

/**
 * What the host is shown when deciding whether to approve someone
 * (ui-scope.md §3.1). Enough to recognise the person they sent the link to,
 * and nothing more than that — we do not want to build a tracking profile
 * to answer a yes/no question.
 */
export const joinRequestInfoSchema = z.object({
  participantId: z.string().uuid(),
  /** e.g. "Android · Chrome" — derived server-side, never client-asserted. */
  deviceLabel: z.string().max(64),
  /** Coarse location only: city and country, from IP. Never coordinates. */
  approximateLocation: z.string().max(96).optional(),
  /** Which path they arrived by; a typed code deserves more scrutiny. */
  joinedVia: z.enum(['code', 'link']),
  requestedAt: z.number().int(),
});
export type JoinRequestInfo = z.infer<typeof joinRequestInfoSchema>;

export const participantSchema = z.object({
  participantId: z.string().uuid(),
  role: participantRoleSchema,
  state: participantStateSchema,
  deviceLabel: z.string().max(64),
  joinedAt: z.number().int().optional(),
});
export type Participant = z.infer<typeof participantSchema>;

/** The public view of a session. Never contains `sessionId` or any token. */
export const sessionSummarySchema = z.object({
  joinCode: joinCodeSchema,
  state: sessionStateSchema,
  createdAt: z.number().int(),
  expiresAt: z.number().int(),
  participants: z.array(participantSchema),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

/**
 * Connection quality as the user sees it. Derived from WebRTC stats
 * server-side vocabulary so all clients label the same conditions the same way.
 */
export const connectionQualitySchema = z.enum(['excellent', 'good', 'poor', 'unstable']);
export type ConnectionQuality = z.infer<typeof connectionQualitySchema>;

/**
 * User-facing connection states (architecture §67). These map to the words
 * shown in the UI; the underlying ICE state is a logging concern.
 */
export const connectionStateSchema = z.enum([
  'connecting',
  'checking',
  'securing',
  'connected',
  'unstable',
  'reconnecting',
  'failed',
]);
export type ConnectionState = z.infer<typeof connectionStateSchema>;
