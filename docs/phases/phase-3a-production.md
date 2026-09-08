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

> **3.1 done, 2026-09-08.** `RATE_LIMITS` had named these numbers since
> Phase 0 and nothing enforced any of them — `SESSION_LOCKED`,
> `RATE_LIMITED` and `TOO_MANY_SESSIONS` all existed as error codes with
> plain-language text and were unreachable in every client.
>
> A new shared `@crossscreen/rate-limit` package (`RateLimiter`) is the
> per-IP half: a sliding window per key, checked in signaling before the
> join-code/link lookup even runs — refusing only failures would still let
> someone try five _correct-looking_ codes a second, so the check has to sit
> ahead of the lookup, not behind it — and in the API service before a
> session is created. "Exponential backoff" turned out to mean the
> `retryAfterMs` hint grows per consecutive refusal while the underlying
> window still re-admits on its own schedule; the two are independent by
> design, so a client's own backoff can be told to wait longer than the
> window strictly requires without the server needing a second clock to
> track that.
>
> The per-session lock is `LiveSession.recordFailedAttempt()` — the other
> half, for a guesser who rotates addresses instead of repeatedly hitting
> the one that's rate limited. It counts a host's rejection and an
> unanswered request timing out the same way, since from the guesser's side
> the two look identical, and locks the session (refusing every _new_ join
> attempt, but not a resume — an already-approved viewer presenting its own
> credentials is not a guess) once ten accumulate.
>
> One real gap this closed in passing: `ApiClient` always showed the same
> generic "having trouble" line regardless of what the server actually
> said, because it never read the response body at all. A rate-limit
> refusal would have been real and completely invisible to whoever hit it.
> `ApiError` now carries the server's own `code`/`userMessage` when the
> body has one, falling back to the generic line only when it does not.
>
> Testing: 11 new unit tests for `RateLimiter` itself (window enforcement,
> backoff growth and reset, sweep hygiene); `LiveSession.recordFailedAttempt`
> tested directly; 9 new handler-level tests (rate limiting, the lock, and
> that a resume bypasses it) using a fresh limiter per test rather than a
> shared wire-level server, specifically to avoid the cross-test pollution a
> shared one would cause; 4 new `ApiClient` tests for the error-surfacing
> fix; 2 new API-side tests for the session-creation limit. Discovered along
> the way: both the wire-level signaling suite and the full Playwright suite
> share one server process and one address (127.0.0.1) across many tests,
> so both now run with the limits turned up via env override
> (`RATE_LIMIT_CODE_PER_MINUTE` etc.) — a fresh find, not a pre-existing
> pattern copied blindly; the first run without it failed nine session-flow
> tests by rate-limiting the test harness against itself. Full monorepo
> build, lint, typecheck and unit suite (260 tests across 12 packages); pnpm
> format; a markdown link check; and the full 18-test Playwright suite, all
> green.
>
> **Not verified:** a real brute-force run against a live deployment, the
> way this phase's own Verification section asks for — everything here is
> proven at the unit and wire-transport level, not against a genuinely
> hostile client hammering a public endpoint.

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

> **3.2 done, 2026-09-08.** A new `session.report` message (either side, any
> point after joining) writes to `abuse_log` — deliberately without asking
> who is at fault, since a viewer reporting a host and a host reporting a
> viewer are the same signal to whoever reads that table afterward. Both
> apps' viewer and sharer screens get a small "Report a problem" affordance
> (`ReportButton`) that turns into "Report received — thank you" once the
> server confirms, never an optimistic local flag. `session_locked` and
> `too_many_sessions` — §3.1's automated refusals — already wrote to the same
> table; a human report is the case those cannot catch, someone who got in
> legitimately and then did something wrong.
>
> The first-share notice (`SafetyNotice.tsx`, both apps) already existed and
> already gated the entire share screen behind it — genuinely unskippable,
> not merely unclosed — but nothing had verified that by test until now; an
> E2E test now confirms the gate blocks `Choose a screen` until acknowledged.
>
> **The documented process is [`docs/abuse-response.md`](../abuse-response.md).**
> It says plainly what this phase's own constraints make true: solo,
> part-time, no alerting or paging exists yet, and a live tech-support-scam
> report right now needs a person reading `abuse_log` by hand, not an admin
> panel that does not exist. Written as the honest process for what actually
> happens today, not the one a bigger team would run.
>
> Testing: 2 new handler-level tests (the abuse-log row shape, and that a
> report with nothing else known is still recorded and confirmed rather than
> dropped); 1 new E2E test proving the report round-trip from both sides of
> one live session; 1 new E2E test proving the safety notice actually blocks
> sharing when not pre-skipped, which nothing had exercised before. Full
> monorepo build, lint, typecheck and unit suite; pnpm format; a markdown
> link check; and the full Playwright suite.
>
> **Not verified:** that a real person, using the process in
> `abuse-response.md`, can actually find and act on a report in production —
> the process is written and the query in it works, but nobody has run it
> against a live report yet.

### 3.3 — Session expiry

A sweeper enforcing `SESSION_TIMEOUTS` — unclaimed at 10 minutes, idle at 5,
absolute ceiling at 12 hours — plus retention on `session_events` and
`connection_stats` so the database does not grow without bound.

> **3.3 done, 2026-09-08.** The sweeper itself has existed since Phase 1/2 —
> `SessionStore`'s sweep, `LiveSession.isExpired`, all three `SESSION_TIMEOUTS`
> already enforced and tested. What was missing was the second half of this
> section's own sentence: retention. `packages/db/src/retention.ts` (the
> `migrate.ts` of deletion — plain SQL, run once and exit, no job-scheduler
> dependency for three tables) deletes anything older than
> `DATA_RETENTION_DAYS` (default 30) from `session_events`,
> `connection_stats` and `abuse_log`. `pnpm --filter @crossscreen/db
retention`, meant to be scheduled daily via cron or a systemd timer once
> there is somewhere to schedule it (§3.4).
>
> **Not verified against a live database this session**, the same disclosed
> gap as §2.1 and §2.4 before it — Docker was not available on this machine.
> The three `DELETE ... WHERE occurred_at < now() - make_interval(days =>
...)` statements are unremarkable SQL, but "unremarkable" is not the same
> claim as "run and watched delete the right rows."

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
