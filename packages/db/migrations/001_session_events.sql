-- Durable records. Live session state is not here: it lives in the signaling
-- service's memory (ADR-0005, ADR-0011), and putting it in a database would
-- put a query in the signaling hot path for state that is ephemeral anyway.
--
-- Nothing in this file stores screen content, audio, or a full IP address.
-- Architecture §42 asks for privacy by design, and a table is where that
-- promise is either kept or quietly broken.

CREATE TABLE IF NOT EXISTS session_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- The internal session id, which never reaches a client.
  session_id    UUID        NOT NULL,
  -- created, host_attached, viewer_requested, viewer_approved,
  -- viewer_rejected, connected, ended
  event         TEXT        NOT NULL,
  participant_id UUID,
  -- Free-form detail: an end reason, a device label. Never a token.
  detail        JSONB,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The questions asked of this table are "what happened in this session" and
-- "how many of these happened this week", in that order.
CREATE INDEX IF NOT EXISTS session_events_session_idx ON session_events (session_id, occurred_at);
CREATE INDEX IF NOT EXISTS session_events_event_time_idx ON session_events (event, occurred_at);

CREATE TABLE IF NOT EXISTS connection_stats (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id      UUID        NOT NULL,
  participant_id  UUID,
  -- 'direct' or 'relay'. The ratio between them is what predicts TURN cost,
  -- and the reason this table exists at all (ADR-0004).
  transport       TEXT        NOT NULL,
  quality         TEXT,
  round_trip_ms   INTEGER,
  resolution      TEXT,
  codec           TEXT,
  frames_per_second REAL,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS connection_stats_transport_idx ON connection_stats (transport, occurred_at);

CREATE TABLE IF NOT EXISTS abuse_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- code_attempt_failed, session_locked, reported
  event       TEXT        NOT NULL,
  -- A hash, never the address. Enough to count repeats from one source,
  -- not enough to identify anyone (architecture §42).
  ip_hash     TEXT,
  detail      JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS abuse_log_ip_time_idx ON abuse_log (ip_hash, occurred_at);
