/**
 * What gets recorded, and what deliberately does not.
 *
 * Nothing here carries screen content, audio, a token, or a full IP address.
 * Architecture §42 asks for privacy by design, and these types are where that
 * promise is either kept or quietly broken — a field added carelessly here
 * reaches a database and stays there.
 */

export type SessionEventName =
  | 'created'
  | 'host_attached'
  | 'viewer_requested'
  | 'viewer_approved'
  | 'viewer_rejected'
  | 'connected'
  | 'ended';

export interface SessionEvent {
  sessionId: string;
  event: SessionEventName;
  participantId?: string;
  /** An end reason, a device label. Never a token, never a code. */
  detail?: Record<string, string | number | boolean>;
}

export interface ConnectionStat {
  sessionId: string;
  participantId?: string;
  /** The ratio of these is what predicts TURN cost (ADR-0004). */
  transport: 'direct' | 'relay' | 'unknown';
  quality?: string;
  roundTripMs?: number;
  resolution?: string;
  codec?: string;
  framesPerSecond?: number;
}

export type AbuseEventName = 'code_attempt_failed' | 'session_locked' | 'reported';

export interface AbuseEvent {
  event: AbuseEventName;
  /** Already hashed by the caller — see `hashIp`. */
  ipHash?: string;
  detail?: Record<string, string | number | boolean>;
}

/**
 * Where records go.
 *
 * Every method returns void and never throws. Recording is observability, and
 * observability must not be able to break the thing it observes: a session
 * that fails because a database was slow is a far worse outcome than a session
 * nobody has a record of.
 */
export interface Recorder {
  sessionEvent(event: SessionEvent): void;
  connectionStat(stat: ConnectionStat): void;
  abuseEvent(event: AbuseEvent): void;
  close(): Promise<void>;
}
