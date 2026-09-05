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

### 2.5 — Quality indicator

The mockup's "Good Connection" label becomes real: derived from measured
round-trip time, packet loss and bitrate rather than from connection state
alone. Thresholds are set from Phase 0.5 and Phase 1 baselines, not invented.

### 2.6 — Sentry

Errors from all three surfaces, with the session id attached so a report can
be correlated with its stats. **Scrubbed:** no tokens, no join codes, no IP
addresses, no screen content.

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
