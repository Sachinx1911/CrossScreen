# ADR-0005 — No Redis in MVP

**Status:** Accepted · 2026-09-05

## Context

The brief listed Redis in the stack. Redis genuinely earns its place when
signaling runs on more than one node — for pub/sub between instances,
presence, and distributed rate limiting. On a single signaling process, an
in-memory `Map` does the same job with less to deploy, monitor and get wrong.

## Decision

**No Redis in MVP.** Live session state lives in memory behind a
`SessionStore` interface. PostgreSQL remains the durable source of truth for
session events, metrics and abuse logs. Redis is introduced in Phase 3a or
later, when horizontal scaling actually requires it.

## Consequences

- **Positive:** one fewer service to run, back up and monitor.
- **Positive:** the interface makes the later change a swap, not a rewrite —
  the escape hatch is designed in without paying for it now.
- **Negative:** the signaling service cannot be horizontally scaled until the
  Redis adapter exists. Acceptable: one Node process handles many thousands of
  WebSocket connections, far past MVP needs.
- **Negative:** a signaling restart drops live sessions. Acceptable for MVP;
  clients already reconnect, and sessions are short-lived by design.
