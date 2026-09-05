# Phase 3a — Production Hardening

**Estimate:** 3–4 weeks part-time · **Depends on:** Phase 2
**This phase ends with a public MVP.**

## Goal

Take a product that works on two developer machines and make it safe to expose
to the internet under a real domain.

## In scope

Rate limiting · abuse prevention · session expiry jobs · deployment to a Mumbai
VPS with TLS · Windows code signing and auto-update · legal pages · basic
operational visibility.

## Out of scope

macOS and Linux validation (Phase 3b) · Android (Phase 4) · Prometheus and
Grafana unless the logs prove insufficient.

## Work breakdown

### 3.1 — Rate limiting

The numbers are already fixed in `RATE_LIMITS` (ADR-0006); this is where they
are enforced:

- 5 join-code attempts per IP per minute, 20 per hour, with exponential backoff.
- A session locks after 10 failed attempts against it.
- 20 session creations per IP per hour.

This is what turns a six-digit code from a weakness into an acceptable trade —
without it, ADR-0006 is only half implemented.

### 3.2 — Abuse prevention

Public screen-sharing services are a standard vector for tech-support scams,
and this is the phase that stops CrossScreen being a convenient tool for one.

- A **Report** affordance in the viewer and the sharer.
- Server-side logging of failed attempts, locks and reports to `abuse_log`.
- The one-time first-share notice from Phase 1, verified as unskippable:
  _"Only share with people you know. CrossScreen will never ask you to share
  your screen with support staff."_
- A documented process for responding to a report — an unmonitored button is
  worse than none.

### 3.3 — Session expiry

A sweeper enforcing `SESSION_TIMEOUTS` — unclaimed at 10 minutes, idle at 5,
absolute ceiling at 12 hours — plus retention on `session_events` and
`connection_stats` so the database does not grow without bound.

### 3.4 — Deployment · `infrastructure/`

Docker Compose on a single VPS in **Mumbai**, chosen for round-trip time to the
initial user base:

```
nginx (TLS, reverse proxy)
  ├── api        (Fastify)
  ├── signaling  (ws)
  └── postgres
```

Cloudflare in front for DNS and TLS. Let's Encrypt on the origin. `api` and
`signaling` stay separate processes, as they have been since Phase 1, so
splitting them onto separate hosts later is a compose change.

Domain layout: `app.` for the web viewer, `api.`, `signal.`. TURN is Cloudflare's
anycast network, so no `turn.` host of our own.

**Note:** `crossscreen.app` has not been checked for availability or trademark
conflict (ADR-0010 open). Do this before ordering certificates or code-signing
under the name.

### 3.5 — Desktop distribution

- Windows code signing. Budget lead time: certificate issuance is not instant.
- `electron-updater` with a signed release feed.
- A download page that labels macOS and Linux builds **untested** until Phase 3b
  — shipping them unlabelled would claim support that has not been verified.

### 3.6 — Legal and operational basics

Privacy policy stating plainly what is not stored: no screen content, no audio,
no recordings, no full IP addresses. Terms of service. A licence decision
(Phase 0 debt). Structured logs with retention. Uptime monitoring on `/healthz`.

## Exit criteria

1. Brute-forcing join codes is rate limited and then locked out, demonstrably.
2. A report can be filed and reaches somewhere a human will see it.
3. Sessions expire on schedule in production, not just in tests.
4. The full flow works over the public domain with valid TLS.
5. The Windows installer is signed and installs without a SmartScreen warning.
6. Auto-update moves a client from one version to the next.
7. The privacy policy matches what the code actually stores — verified by
   reading the schema, not by assumption.
8. A restart of the VPS brings everything back without manual steps.

## Verification

A scripted brute-force attempt against the code endpoint, confirming lockout.
An external TLS check. Install, update and uninstall on a clean Windows VM.
A full restart of the host. A read-through of the privacy policy against the
database schema.

## Risks

| Risk                                                         | Mitigation                                                                   |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Code-signing certificate lead time blocks the release        | Start the application at the beginning of the phase, not the end             |
| The domain is unavailable or conflicts with an existing mark | Resolve ADR-0010 before anything is printed, signed or published             |
| A single VPS is a single point of failure                    | Accepted for MVP. Nightly database backups off-host are the mitigation       |
| An abuse report arrives with no process behind it            | Write the process in this phase, before launch, not after the first incident |
