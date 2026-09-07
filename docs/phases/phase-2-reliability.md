# Phase 2 — Reliability

**Estimate:** 4–5 weeks part-time · **Depends on:** Phase 1

## Goal

Make the connection survive the real world. Phase 1 proves the product works
on a good network; this phase makes it keep working when someone walks out of
Wi-Fi range, closes a laptop lid, or sits behind a corporate firewall.

This is the phase most screen-sharing projects underestimate, and the reason
the MVP estimate is months rather than weeks.

## In scope

TURN with short-lived credentials · a forced-relay test mode · ICE restart ·
reconnection across network changes · sleep and wake · the stats pipeline ·
Sentry · the quality indicator driven by real measurements.

## Out of scope

Rate limiting and abuse controls (Phase 3a) · deployment (Phase 3a) ·
multi-viewer (Phase 5).

## Work breakdown

### 2.1 — TURN credentials · `services/api`

`GET /api/v1/ice-servers` returns Cloudflare TURN credentials with a short
lifetime, replacing the Phase 0.5 hardcoded `.env` values.

The endpoint is the abstraction ADR-0004 depends on: **no client ever hardcodes
a provider**, so switching to coturn later is a server configuration change
rather than a release of five clients. Credentials are requested at session
start and refreshed if a session outlives them.

### 2.2 — Forced-relay mode

A developer setting that pins `iceTransportPolicy` to `relay`. Without it, the
relay path is only exercised by accident, on networks that happen to fail P2P —
which means it silently rots. With it, every test run can cover both paths.

This is also how the "added latency via TURN" figure in architecture §9 gets
measured honestly.

> **Done, 2026-09-07.** `?relay=1` (browser, both apps) and `VITE_FORCE_RELAY=1`
> (desktop, both apps) now pin every peer connection to relay-only, and each
> session refuses to start with a plain-language message when no TURN server is
> configured, rather than gathering nothing and failing silently. `hasTurnServer`
> already existed, fully unit-tested, with a doc comment claiming both sessions
> checked it — neither did. `dev-setup.md` had documented the refusal as already
> working too. Both were ahead of the code; the e2e suite now proves the real
> behaviour rather than the intended one.
>
> **Proven end to end, 2026-09-07.** Both surfaces reported `relayed` against
> real Cloudflare TURN credentials — which closed
> [Phase 0.5](phase-0.5-walking-skeleton.md)'s last outstanding criterion.
> Getting there also fixed `pnpm turn`, which had been writing `VITE_TURN_*`
> into the two apps' `.env.local` files since before `GET /api/v1/ice-servers`
> existed. Nothing has read those variables since Phase 1 — the API service
> reads unprefixed `TURN_URLS` / `TURN_USERNAME` / `TURN_CREDENTIAL` from its
> own environment — so the script reported success while configuring nothing,
> and the endpoint kept handing out STUN alone.
>
> **2.1 done, 2026-09-07.** `GET /api/v1/ice-servers` now mints its own
> credential from a long-term Cloudflare key on every call it needs to —
> `TurnCredentialSource` (`services/api/src/turn.ts`) caches the result and
> refetches ahead of its expiry (`TURN_CREDENTIAL_TTL_SECONDS`, four hours by
> default) rather than asking Cloudflare fresh per request, since every sharer
> and viewer calls this endpoint at the start of every session and a short
> lifetime is what makes a credential short-lived, not how few callers share
> it. A network problem reaching Cloudflare serves the last cached credential
> rather than failing the endpoint outright, and no configuration at all falls
> back to STUN-only with one loud warning at startup — never a hard failure,
> since a connection between two friendly networks needs no TURN at all.
> `pnpm turn` now does only the one-time setup step this can't do itself:
> getting the long-term key from the dashboard into the service's environment.
> The key itself still never reaches a client — only what is minted from it.

### 2.3 — ICE restart and reconnection

The cases that actually occur, in the order they occur:

| Event                       | Expected behaviour                                                  |
| --------------------------- | ------------------------------------------------------------------- |
| Wi-Fi to mobile handover    | ICE restart, recovered under 5 s, session preserved                 |
| Brief connectivity loss     | Reconnect with backoff; the session is not torn down                |
| Laptop sleep and wake       | Detect, restart, resume without a new join                          |
| Mobile browser backgrounded | Viewer survives; a paused video is not a dropped session            |
| Signaling socket drops      | Reconnect with exponential backoff and jitter                       |
| TURN unreachable            | Report `CONNECTION_FAILED` with the plain-language text, not a hang |

The rule throughout: **a temporary network problem must never require the user
to ask for a new code.** Rejoining is a failure of this phase.

Reconnection needs a session-recovery token so the returning peer proves it is
the same participant without a second approval round.

> **Transport-level reconnection landed 2026-09-07.** `SignalingClient` now
> retries a dropped socket on an exponential schedule with jitter — half a
> second doubling to ten, giving up after a minute, which is set by the
> server's own idle sweep rather than picked. The schedule is a pure,
> injectable `ReconnectSchedule` with unit tests, per this phase's risk
> mitigation: reconnection decisions belong behind something testable rather
> than spread across UI timers.
>
> Both sessions now report `reconnecting` instead of ending, which is the
> correct answer for the common case — **media is peer-to-peer and never went
> through that socket**, so a picture stays live while signaling is away. The
> session is only declared lost once retrying gives up, by which point the
> server really has swept it.
>
> **Host-side grace period landed 2026-09-07.** A dropped host socket is held
> for 90 seconds (`LiveSession.hostGraceMs`) rather than ending the session on
> the spot, and a reattaching host rebinds to its existing session by id, so an
> approved viewer's participant list is not silently stranded. A genuinely
> closed tab still ends things immediately via `pagehide` sending
> `session.end`. See the commit for the `expired` vs `host_ended` distinction.
>
> **Viewer-side resume landed 2026-09-07**, the symmetric half of the host
> grace period above. An approved viewer's socket dropping is held for the
> same 90 seconds (`LiveSession`'s per-viewer `awaySince`, `config.viewerGraceMs`)
> instead of removing it and telling the host `peer.left` on the spot. On
> reconnect, `ViewerSession` presents the `participantId`/`participantToken`
> it was issued at approval in a `resume` field on `session.viewer.request`;
> the server rebinds the existing viewer rather than re-queuing it as pending,
> so it resumes watching with no second approval round. A resume that does not
> check out — wrong token, already reclaimed by the grace sweep, never
> approved — is not an error: it falls straight through to an ordinary fresh
> request, which is what a mismatch should look like.
>
> A deliberately closed tab needed the same treatment the host got: a new
> `session.viewer.leave` message, sent on `pagehide` and from `stop()`, removes
> the viewer immediately and tells the host right away, rather than the
> departure being indistinguishable from a network blip and sitting in the
> grace window for 90 seconds first.
>
> One more gap this closed in passing: `SignalingClient.onState` told the UI
> to show "Reconnecting…" but never told it to stop — nothing else re-read the
> peer connection's own state once signaling came back, so the label could get
> stuck showing forever after a purely signaling-side outage. Both sessions now
> re-emit the real connection state on `state === 'open'`.
>
> **ICE restart landed 2026-09-07**, closing the remaining piece: recovering
> the _media_ path itself after a real network change, as distinct from
> `SignalingClient`'s own reconnect, which only ever repairs the signaling
> socket and cannot touch ICE at all.
>
> The sharer is always the offerer in this architecture (the viewer only ever
> answers), so it is the only side that can perform a restart — `restartIce()`
> plus a fresh `createOffer()`/`setLocalDescription()`, sent as an ordinary
> `rtc.offer` on the _same_ `RTCPeerConnection`, never a new one, so the track
> and everything already tuned about it survive. A viewer that notices
> `connectionState === 'failed'` first cannot restart itself, so it asks via
> `rtc.restart`; the sharer restarts on either that or noticing the failure
> directly. Both sides guard against asking or acting twice for one outage —
> `connectionState` can report `'failed'` more than once while a restart is
> already in flight — and clear the guard once `'connected'` is seen again.
> The viewer's `#answer` now tells a first offer from a restart one by whether
> it already holds a peer connection, and reuses it rather than rebuilding.
>
> **Verified at the wire level, not against a genuine connectivity failure.**
> A test proves `rtc.restart` relays correctly with a server-asserted sender in
> both directions, which is the plumbing both sides depend on. What is not
> verified is the client logic actually recovering a real ICE failure: forcing
> one needs breaking the underlying UDP path while a connection is established,
> which is outside what Playwright's network interception can do — it acts on
> fetch/WebSocket traffic through the browser, not the OS-level UDP sockets
> WebRTC uses. Real verification needs the same kind of network chaos the
> Phase 0.5 gate needed and got by hand — two networks, a connection forced to
> fail, and a recovery watched — which is worth doing before this line is
> called proven rather than merely written.

### 2.4 — Stats pipeline

Clients already send `stats.report`. This phase lands them in
`connection_stats` and makes them answerable:

- What fraction of connections go **direct versus relayed**? This is the
  leading indicator of TURN cost (ADR-0004) and the number that decides when
  self-hosting coturn becomes worthwhile.
- Time to connect, at median and 95th percentile.
- Failure reasons, grouped.
- Round-trip time, packet loss, bitrate, resolution, frame rate, codec.

Enough to answer every question in architecture §80 about a failed session
without asking the user to reproduce it.

> **2.4 done, 2026-09-07.** Two fields `stats.report` had always carried —
> `packetLossPct`, `bitrateKbps` — were being parsed and then discarded before
> reaching `connection_stats`; a third, `connectionState`, was never stored at
> all, so a client-observed `'failed'` never left the client that saw it.
> `002_stats_pipeline.sql` adds all three columns. A one-time `connected`
> session event, written the first time a connection's own reports says
> `connectionState: 'connected'` rather than on every report after, is what
> "time to connect" is now measurable against — nothing wrote that event
> before this, so the question had no data to answer it with. Every path in
> `dev-setup.md`'s expanded stats section — the relay ratio, time to connect
> at p50/p95, failure reasons grouped by both session-end reason and live
> `connectionState: 'failed'` reports, and the full per-session detail row —
> is now backed by a column that actually gets written.
>
> The recorder-facing half is covered by
> `services/signaling/src/handlers.test.ts` (new), asserting directly against
> a fake recorder rather than over the wire: `stats.report` sends nothing
> back, so the session-flow suite that already exercises the wire has no way
> to see whether a report reached storage. **Not re-verified against a live
> Postgres** — Docker Desktop was not available on this machine this session,
> so the new columns are unconfirmed against a real database the way the
> existing ones were on 2026-09-06. The migration is three additive `ALTER
TABLE ADD COLUMN` statements in the same shape as ones that already ran
> clean, which is why this is recorded as done rather than blocked on it —
> but it is real verification still owed, not assumed.

### 2.5 — Quality indicator

The mockup's "Good Connection" label becomes real: derived from measured
round-trip time, packet loss and bitrate rather than from connection state
alone. Thresholds are set from Phase 0.5 and Phase 1 baselines, not invented.

> **2.5 done, 2026-09-07.** Two problems, not one: `qualityFrom` graded on
> round-trip time alone, and — found while fixing that — `packetLossPct` and
> `bitrateKbps` were never actually computed. `stats.report`'s schema had
> carried both since before this phase, `connection_stats` grew columns for
> both in 2.4, and neither client ever filled them in; every row 2.4 added
> those columns for was going to read `null` forever. `getStats()` only ever
> hands back cumulative counters, so a rate needs two samples — the previous
> tick's raw counters now travel with `SharerSession` and `ViewerSession`
> across their `#startStats` intervals and get threaded back into
> `readConnectionSnapshot` (`packages/webrtc-core/src/stats.ts`), which is
> also where the two derivations (`deriveBitrateKbps`, `derivePacketLossPct`)
> live as pure, independently tested functions.
>
> `qualityFrom` now grades the _weakest_ of whichever dimensions were actually
> measured — round-trip time, packet loss, and available bandwidth (not
> `bitrateKbps` itself: a static screen legitimately sends almost nothing
> while perfectly healthy under `maintain-resolution`, so grading by bytes
> actually sent would call an idle, healthy connection "unstable"; the ICE
> layer's own bandwidth _estimate_ has no such problem). "Weakest", not an
> average — a connection with a fine round-trip time and 8% loss is bad, full
> stop, and averaging would hide exactly the number worth seeing.
>
> **Thresholds, honestly sourced, not uniformly a project baseline.**
> Bandwidth is the one dimension with real numbers behind it: `avail=300kbps`
> and `avail=5302kbps` are both from passing Phase 0.5 runs
> ([Windows and macOS, 2026-09-05/06](phase-0.5-walking-skeleton.md)) — 300
> was still watchable at 1080p, 5302 is comfortably above what any of this
> needs. Round-trip time and packet loss are not: every RTT Phase 0.5 ever
> logged was a same-machine or same-LAN reading of about 1 ms, which says
> nothing about a real link, and nothing measured loss at all before this
> phase. Those two use commonly cited reference points instead (ITU-T G.114
> for round-trip time, standard video-conferencing guidance for loss —
> `qualityFrom`'s own comments carry the numbers and the reasoning) — real,
> not invented, but not this project's own data either. Worth revisiting once
> real usage produces a dataset.
>
> The mockup's label itself now exists: `QualityBadge` (`apps/web`'s
> `Primitives.tsx`, `apps/desktop`'s `components.tsx`) sits next to
> `StatusDot` on both viewer surfaces, shown once a connection actually
> reaches `connected` — quality means nothing while still negotiating, and
> `StatusDot` already covers that wait.
>
> 12 new unit tests in `stats.test.ts` and `sharer-session.test.ts` cover the
> two derivations directly (two-sample requirement, the arithmetic, clock and
> counter-reset guards) and `qualityFrom`'s per-dimension grading and
> weakest-wins behaviour. Full monorepo build, lint, typecheck and unit suite
> (55 webrtc-core tests, up from 43); pnpm format; a markdown link check; and
> the full 18-test Playwright E2E suite, all green. Not exercised against a
> real degraded link this session, the same disclosed gap as ICE restart in
> §2.3 — Playwright's network interception cannot touch the UDP path WebRTC
> actually uses, so `deriveBitrateKbps`/`derivePacketLossPct` are proven
> correct against synthetic counters, not against a connection genuinely
> losing packets.

### 2.6 — Sentry

Errors from all three surfaces, with the session id attached so a report can
be correlated with its stats. **Scrubbed:** no tokens, no join codes, no IP
addresses, no screen content.

> **2.6 done, 2026-09-07.** All four processes — `api`, `signaling`, the web
> viewer, and the desktop app's main _and_ renderer processes — report to
> Sentry when `SENTRY_DSN`/`VITE_SENTRY_DSN` is set, and run exactly as before
> (logging only) when it is not, the same absent-is-fine pattern as
> `DATABASE_URL` and `CLOUDFLARE_TURN_KEY_ID`.
>
> **Scrubbing is one function, not four copies of the same regex.**
> `@crossscreen/observability`'s `scrubSentryEvent` walks `extra`, `contexts`,
> `tags`, breadcrumb data, `request`, `user`, and the message/exception text
> itself, dropping anything keyed like a secret and redacting bare join codes
> and IP-shaped substrings wherever they appear — wired into every surface's
> `beforeSend`, so there is one place this promise can be wrong instead of
> four. `sendDefaultPii: false` is set explicitly everywhere too, rather than
> trusted as a default. 10 unit tests in `scrub.test.ts` pin down each of
> §2.6's three concrete promises, plus that scrubbing reaches nested objects
> and breadcrumbs, not only the top level.
>
> **"With the session id attached" turned out to mean `participantId`, not
> the internal session id** — `sessionSummarySchema`'s own doc comment says
> plainly that a client is never handed the internal id (architecture §7), so
> nothing client-side could tag a report with it even in principle. Every
> `connection_stats`/`session_events` row already carries `participantId`
> too (§2.4), which is what actually lets a report be correlated with the
> data without crossing that boundary. Wired for the viewer surfaces (web,
> desktop) via a new `participant` event on `ViewerSession`; **not wired for
> the sharer surfaces** — the host's own id sits inside the host token's JWT
> claims, undecoded client-side today, and decoding it just for a telemetry
> tag felt like more new surface than this pass justified. Worth adding if
> per-report correlation on the sharer side is ever actually needed.
>
> Two real catch boundaries per Node service — the Fastify error handler
> (new; nothing was logging a route handler throwing before this, with
> `logger: false` set) and the top-level `handleMessage` catch in signaling —
> call `Sentry.captureException` directly with the real `Error` object.
> Everywhere else, every existing `log.error(...)` call also reaches Sentry
> via a decorator on `Logger.error` in each service's own `log.ts`, so no
> other call site needed touching — and since `Logger.error` takes an event
> name and a field bag rather than an `Error`, those go through
> `captureMessage`, without a stack trace. Also new: both services now catch
> `uncaughtException`/`unhandledRejection` at the process level, which
> nothing did before — either would have crashed, or been silently dropped,
> with no record anywhere.
>
> **Not wired:** the Electron `@sentry/electron/preload` bridge that would
> correlate main-process and renderer-process events into one Electron
> "session" — each process reports independently instead, which loses that
> correlation and nothing else.
>
> **Not verified against a real Sentry project.** Everything above is proven
> at the unit level — the scrubbing, the one-time-per-connected-event guard,
> every surface's `initSentry` reading its DSN correctly — but nothing here
> has an actual DSN and watched an event land in a real Sentry dashboard,
> the way the TURN credentials in §2.1 were proven against a real Cloudflare
> account. That is the next honest step before this line is called proven
> rather than merely wired: set `SENTRY_DSN`/`VITE_SENTRY_DSN` on all four
> surfaces against one real project and confirm a deliberately thrown error
> from each surface arrives, scrubbed.

## Exit criteria

1. Walking from Wi-Fi to mobile data recovers in under 5 seconds without
   rejoining.
2. Closing and reopening a laptop lid resumes the session.
3. Forced-relay mode works, and the latency it adds is measured and recorded.
4. A 30-minute session survives without manual intervention.
5. The direct-versus-relay ratio is visible in the data.
6. Every failure mode in 2.3 produces a plain-language message, never a hang.
7. Sentry receives errors from web, desktop and both services, with no secrets.

## Verification

Scripted network chaos: disable Wi-Fi mid-session, switch networks, throttle to
3% packet loss and 200 ms round-trip time, block UDP entirely to force TURN.
`tc netem` on Linux and Chrome DevTools throttling for the browser side.

The packet-loss run doubles as the check that degradation behaves as designed:
under pressure the **frame rate must drop and the resolution must hold**
(architecture §9). If resolution drops instead, `degradationPreference` is not
being applied and text becomes unreadable.

## Risks

| Risk                                                            | Mitigation                                                                                                |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Reconnection logic becomes the most complex code in the product | Keep it in `packages/webrtc-core` behind a state machine with unit tests, not spread across UI components |
| A high relay ratio means TURN costs arrive sooner than expected | This phase is what makes it measurable. Alert on it rather than discovering it in a bill                  |
| Sleep and wake behaves differently per OS                       | Windows is validated here; macOS and Linux are re-checked in Phase 3b                                     |
