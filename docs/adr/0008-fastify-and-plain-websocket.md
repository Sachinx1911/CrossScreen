# ADR-0008 — Fastify + plain `ws`, not NestJS or Socket.IO

**Status:** Accepted · 2026-09-05

## Context

The backend does two things: a small HTTP API (sessions, tokens, ICE
credentials, rate limits) and a WebSocket signaling channel. Node + TypeScript
was chosen so that one `packages/protocol` is literally shared with the web
viewer and Electron app. The remaining questions were framework and transport.

**Socket.IO** would supply rooms and reconnection, but it is not plain
WebSocket on the wire. Every native client — Kotlin now, Swift later — would
need a Socket.IO implementation, and the protocol would stop being trivially
readable. Its useful features amount to roughly 200 lines we can own.

**NestJS** brings structure that a service of this size does not need, at the
cost of weight and indirection for a solo developer.

## Decision

**Fastify** for the HTTP API, **`ws`** with a custom JSON protocol over WSS for
signaling. Envelope: `{ v: 1, type, id, ts, payload }`.

## Consequences

- **Positive:** a plain WebSocket is trivially implementable on every platform,
  including Kotlin and Swift, from the same JSON Schema.
- **Positive:** the wire format is human-readable, which matters when debugging
  signaling across five platforms.
- **Negative:** rooms, heartbeats and reconnection are ours to write and test.
  Accepted — the semantics are ones we need to control precisely anyway,
  because host approval sits inside them.
- `api` and `signaling` run as separate processes from day one, deployed to one
  VPS. Splitting them later is a deployment change, not a refactor.
