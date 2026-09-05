# ADR-0006 — Host approval is mandatory

**Status:** Accepted · 2026-09-05

## Context
The design specifies a friendly 6-digit join code (`482 719`). That is only
~20 bits — one million combinations — which is trivially brute-forced against
a public endpoint. The brief simultaneously required "sufficient entropy", so
the specification contradicted itself.

Dropping the short code would hurt the product: reading a code aloud to a
friend is a core part of the experience.

## Decision
Keep the 6-digit code for UX, but **it never grants access.** It is a lookup
key only. Both entry paths — typed code and share link — land the viewer in a
*pending* state, and **host approval is mandatory** before any SDP is
exchanged.

Supporting controls:
- The share link carries a **128-bit `joinToken`**, not the 6-digit code.
- Rate limits: 5 code attempts/IP/minute, 20/hour, exponential backoff;
  session locks after 10 global failures.
- Unclaimed sessions expire in 10 minutes; idle sessions in 5; hard cap 12 hours.
- Codes come from a CSPRNG, checked for collision against active sessions only.
- The viewer's per-participant token is issued only *after* approval and is
  scoped to one session and one connection.

## Consequences
- **Positive:** the short code becomes safe without losing its friendliness.
- **Positive:** brute-force yields a pending request the host will reject, not
  access.
- **Negative:** one extra step in the join flow. Accepted — for a product whose
  failure mode is a stranger watching your desktop, the confirmation is a
  feature, and it doubles as the primary defence against tech-support scams.
- **The approval prompt is missing from the design mockup and must be
  designed.** See [`../ui-scope.md`](../ui-scope.md) §3.1.
