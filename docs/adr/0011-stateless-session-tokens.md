# ADR-0011 — Session tokens are self-contained; signaling owns live state

**Status:** Accepted · 2026-09-06

## Context

Phase 1 has to make sessions real, and the first slice of it surfaces a
conflict between two decisions already taken.

ADR-0008 runs `api` and `signaling` as **separate processes** from day one, so
that splitting them across hosts later is a deployment change rather than a
refactor. ADR-0005 keeps live session state **in memory**, because Redis earns
nothing on a single node and is a service to run, monitor and get wrong.

Those are both right, and together they leave a gap. `api` creates a session;
`signaling` has to recognise it moments later. Two processes cannot share one
`Map`.

The obvious repairs are all worse than the problem:

|                                   | Why not                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| Introduce Redis now               | Reverses ADR-0005 for a single-node deployment, to solve a problem the design can avoid   |
| Put sessions in PostgreSQL        | Puts a database read in the signaling hot path, for state that is ephemeral by definition |
| `api` calls `signaling` over HTTP | Invents an internal protocol, and makes creating a session fail when signaling restarts   |
| Merge them into one process       | Reverses ADR-0008, and the split is the cheap part to keep                                |

## Decision

**Session tokens carry their own claims, and live session state belongs to
`signaling` alone.**

- `api` mints `hostToken` as a **signed JWT** containing `sessionId`,
  `joinCode`, `joinToken` and `expiresAt`. It writes a `session.created` row
  for observability and keeps nothing else. Creating a session touches no
  shared state at all.
- `signaling` verifies that signature with the shared secret. No lookup is
  needed to trust the claims, so there is nothing to share.
- A live session **comes into existence when the host attaches**, indexed in
  signaling's memory by `joinCode` and `joinToken`.
- A viewer presenting a code or token is resolved against that index.

## Consequences

- **The gap closes without reversing either decision.** ADR-0005 and ADR-0008
  both stand, and no service is added.
- **A session nobody is hosting cannot be joined, and that is correct.** There
  is no screen to see. A viewer arriving early gets `SESSION_NOT_FOUND`, which
  is what the join code means when the host has not started yet — and the same
  answer a guessed code gets, so the two are indistinguishable to someone
  probing. That is a small, free win for ADR-0006.
- **`api` can restart mid-session without disturbing anyone.** It holds nothing
  a live session needs.
- **Negative: signaling restarting drops every live session.** Already accepted
  under ADR-0005, and unchanged by this: clients reconnect, and sessions are
  short-lived by design.
- **Negative: a shared secret now spans two services.** It is one environment
  variable, must differ per environment, and must never be committed. That is
  the whole cost, and it is smaller than any of the alternatives above.
- **Negative: `hostToken` cannot be revoked before it expires**, since nothing
  is consulted to validate it. Acceptable at a 12-hour lifetime for anonymous
  sessions; revocation becomes a real requirement only alongside accounts, and
  a token store is the answer then.

## What this does not change

`joinCode` remains a lookup key that grants nothing. The claims inside
`hostToken` prove _who created a session_, never that a viewer may watch one —
that still requires host approval, and no SDP is relayed before it (ADR-0006).
