# Roadmap

> This is the summary view. **Each phase has its own detailed plan** —
> goal, scope, work breakdown, exit criteria, verification and risks — in
> [`phases/`](phases/). Start at [`phases/README.md`](phases/README.md).

Assumes **one developer, part-time (~10–15 hrs/week)**. Estimates are calendar
time under that constraint and are deliberately conservative.

Three rules that follow from being solo, and from the product being free:

1. **Nothing gets self-hosted that a free tier can do.** Operations burden is
   the fastest way to stall a solo project.
2. **Only Windows is validated in Phase 1.** The Electron code is written once
   for all three desktop OSes — that is why Electron was chosen — but macOS and
   Linux stay marked _untested_ until Phase 3b. This is a testing-scope
   reduction, **not** an architecture change.
3. **The browser sharer is the way in; the desktop app is the upgrade**
   ([ADR-0010](adr/0010-browser-sharer-is-the-primary-path.md)). Shipping a
   desktop app to strangers costs about $320/year in certificates before the
   first user arrives, and unsigned is not a free alternative — Windows warns,
   macOS refuses. A browser tab needs none of it and reaches all three desktop
   OSes in one deploy. Electron is still built and still tested; it is simply
   distributed when signing exists rather than before.

**What it costs to run, and where free ends:** [`cost-model.md`](cost-model.md).
**What stands between a build and a user:** [`distribution.md`](distribution.md).

| Phase                                           | Deliverable                                                                                                                                                                      | Estimate | Status  |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- |
| **[0](phases/phase-0.md)**                      | Repo, monorepo scaffold, CI, `packages/protocol` v0, docs + ADRs                                                                                                                 | ~1 wk    | ✅ done |
| **[0.5](phases/phase-0.5-walking-skeleton.md)** | **Walking skeleton — GO/NO-GO GATE.** Hardcoded session, zero UI, no DB: Electron on Windows captures a screen → WSS signaling → Chrome on a _different network_ renders it live | 1–2 wk   | —       |
| **[1](phases/phase-1-mvp-core.md)**             | MVP core: web viewer, session create/join/**approve**, lifecycle, Postgres, real error states, sharer + viewer UI                                                                | 8–10 wk  | —       |
| **[2](phases/phase-2-reliability.md)**          | Reliability: Cloudflare TURN, forced-relay test mode, ICE restart, Wi-Fi↔mobile reconnection, sleep/wake, stats, Sentry                                                          | 4–5 wk   | —       |
| **[3a](phases/phase-3a-production.md)**         | Production: rate limiting, abuse controls, expiry jobs, Mumbai VPS + TLS, Windows code signing, auto-update                                                                      | 3–4 wk   | —       |
| **[3b](phases/phase-3b-macos-linux.md)**        | macOS + Linux validation, promotion to supported                                                                                                                                 | 2–3 wk   | —       |
| **[4](phases/phase-4-android.md)**              | Android sharing (native Kotlin)                                                                                                                                                  | 6–8 wk   | —       |
| **[5](phases/phase-5-multi-viewer.md)**         | Multi-viewer over P2P mesh (2–3 viewers), no SFU                                                                                                                                 | 2–3 wk   | —       |
| **[6](phases/phase-6-quality-audio.md)**        | AV1 opt-in, adaptive tuning, system audio (Windows first)                                                                                                                        | 3–4 wk   | —       |
| **[7](phases/phase-7-teaching-mode.md)**        | Teaching Mode: pointer, laser, annotation, chat over DataChannel                                                                                                                 | 4–6 wk   | —       |
| **[8](phases/phase-8-10-long-term.md)**         | iOS sharing (ReplayKit) — its own sub-project                                                                                                                                    | 8–12 wk  | —       |
| **[9](phases/phase-8-10-long-term.md)**         | SFU via LiveKit + SFrame E2EE                                                                                                                                                    | 6+ wk    | —       |
| **[10](phases/phase-8-10-long-term.md)**        | Remote control — per-OS, explicit approval, separate design doc                                                                                                                  | —        | —       |

**A shippable public MVP (Phases 0 → 3a) is roughly 4–6 months part-time.**
Anything shorter is not counting reconnection, TURN and code signing — which
is where screen-sharing products actually spend their time.

## The Phase 0.5 gate

Nothing in Phase 1 begins until this passes:

- Two physically separate machines, on **different networks** (home Wi-Fi and a
  mobile hotspot), establish a session and render a live screen.
- `RTCPeerConnection.getStats()` shows a `candidate-pair` in state `succeeded`.
- The run is repeated with `iceTransportPolicy: 'relay'` forced, proving the
  TURN path works independently of P2P.

If this cannot be made to work reliably, the architecture is wrong and it is
far cheaper to find out in week three than in month five.

## Deferred out of MVP

Each of these is a deferral, not a cancellation: accounts, billing, chat,
recording, system audio, annotation, remote control, iOS sharing, SFU,
Prometheus/Grafana (Sentry and structured logs only until Phase 3a).
