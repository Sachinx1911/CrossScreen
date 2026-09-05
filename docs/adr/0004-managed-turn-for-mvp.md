# ADR-0004 — Cloudflare Realtime TURN for MVP

**Status:** Accepted · 2026-09-05

## Context

TURN is required whenever P2P fails, and TURN bandwidth is typically the
largest variable cost in a screen-sharing product. Options: self-host coturn
from day one, or use a managed anycast service.

For a solo part-time developer, running coturn means owning TLS certificates,
port 443 configuration, credential rotation, capacity and a single region —
poor latency for a geographically spread user base. Cloudflare Realtime TURN
is anycast (good for India), speaks TLS on 443 out of the box, and is free for
the first 1 TB/month, then $0.05/GB. Published break-even against self-hosted
coturn is around ~5M minutes/month — far beyond anything the MVP will see.

## Decision

**Cloudflare Realtime TURN for MVP.** Revisit coturn only if sustained usage
approaches the break-even point.

## Consequences

- **Positive:** removes the hardest piece of infrastructure from the critical
  path, at effectively zero cost and zero operations.
- **Positive:** TLS/443 is the default transport, so corporate firewalls are
  handled from day one rather than as a later fix.
- **Negative:** a vendor dependency. **Mitigated** by serving ICE
  configuration from our own `GET /api/v1/ice-servers` endpoint with
  short-lived credentials. Clients never hardcode a provider, so switching is
  a configuration change, not a client release.
- **Must measure from day one:** the ratio of relayed to direct connections.
  It is the leading indicator of future cost.
