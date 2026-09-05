# ADR-0007 — No accounts in MVP

**Status:** Accepted · 2026-09-05

## Context

The core use case — "show my friend what I'm doing" — needs no identity.
Registration is friction placed directly in front of the product's value, and
account systems bring password handling, email delivery, recovery flows and
data-protection obligations.

## Decision

**Fully anonymous sessions in MVP.** No sign-up, no sign-in, no password.
Security comes from short-lived sessions, high-entropy tokens, mandatory host
approval (ADR-0006) and rate limiting — not from identity.

## Consequences

- **Positive:** the shortest possible path from landing page to a working
  screen share; supports the "No Account Required" promise in the design.
- **Positive:** no credential store, so no credential breach.
- **Negative:** no cross-device session history. "Recent Sessions" in the
  mockup is therefore backed by `localStorage` only — per device, never
  synced. See [`../ui-scope.md`](../ui-scope.md) C3.
- **Negative:** abuse control must be IP- and behaviour-based rather than
  account-based.
- The mockup's "Sign In", "Get Started" and "Pricing" navigation is cut from
  v1 (C2). Accounts return only if a feature actually requires identity.
