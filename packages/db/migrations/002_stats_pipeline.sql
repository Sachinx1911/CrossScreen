-- Phase 2.4: makes connection_stats able to answer what it was built for.
--
-- Two of stats.report's fields were being parsed and then thrown away before
-- reaching this table — packet loss and bitrate, the two numbers a firewall
-- or a saturated link actually shows up in first. connection_state is new:
-- without it, a client-observed 'failed' never left the client, and "why did
-- this session fail" had no row to point at.

ALTER TABLE connection_stats ADD COLUMN IF NOT EXISTS packet_loss_pct REAL;
ALTER TABLE connection_stats ADD COLUMN IF NOT EXISTS bitrate_kbps REAL;
-- connecting, checking, securing, connected, unstable, reconnecting, failed
-- (packages/protocol's connectionStateSchema — kept as TEXT here rather than
-- a CHECK constraint for the same reason `event` on session_events is TEXT:
-- the schema already owns this enum, and a second copy of it in SQL is one
-- more place for the two to quietly drift).
ALTER TABLE connection_stats ADD COLUMN IF NOT EXISTS connection_state TEXT;

-- The question this table answers most often is "what happened in this one
-- session" (matching session_events' own index), not only the transport
-- rollup the original index was built for.
CREATE INDEX IF NOT EXISTS connection_stats_session_idx ON connection_stats (session_id, occurred_at);
