# Roadmap

Assumes **one developer, part-time (~10–15 hrs/week)**. Estimates are calendar
time under that constraint and are deliberately conservative.

Two rules that follow from being solo:

1. **Nothing gets self-hosted that a free tier can do.** Operations burden is
   the fastest way to stall a solo project.
2. **Only Windows is validated in Phase 1.** The Electron code is written once
   for all three desktop OSes — that is why Electron was chosen — but macOS and
   Linux stay marked _untested_ until Phase 3b. This is a testing-scope
   reduction, **not** an architecture change.

| Phase   | Deliverable                                                                                                                                                                      | Estimate | Status         |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------- |
| **0**   | Repo, monorepo scaffold, CI, `packages/protocol` v0, docs + ADRs                                                                                                                 | ~1 wk    | 🔨 in progress |
| **0.5** | **Walking skeleton — GO/NO-GO GATE.** Hardcoded session, zero UI, no DB: Electron on Windows captures a screen → WSS signaling → Chrome on a _different network_ renders it live | 1–2 wk   | —              |
| **1**   | MVP core: web viewer, session create/join/**approve**, lifecycle, Postgres, real error states, sharer + viewer UI                                                                | 8–10 wk  | —              |
| **2**   | Reliability: Cloudflare TURN, forced-relay test mode, ICE restart, Wi-Fi↔mobile reconnection, sleep/wake, stats, Sentry                                                          | 4–5 wk   | —              |
| **3a**  | Production: rate limiting, abuse controls, expiry jobs, Mumbai VPS + TLS, Windows code signing, auto-update                                                                      | 3–4 wk   | —              |
| **3b**  | macOS + Linux validation, promotion to supported                                                                                                                                 | 2–3 wk   | —              |
| **4**   | Android sharing (native Kotlin)                                                                                                                                                  | 6–8 wk   | —              |
| **5**   | Multi-viewer over P2P mesh (2–3 viewers), no SFU                                                                                                                                 | 2–3 wk   | —              |
| **6**   | AV1 opt-in, adaptive tuning, system audio (Windows first)                                                                                                                        | 3–4 wk   | —              |
| **7**   | Teaching Mode: pointer, laser, annotation, chat over DataChannel                                                                                                                 | 4–6 wk   | —              |
| **8**   | iOS sharing (ReplayKit) — its own sub-project                                                                                                                                    | 8–12 wk  | —              |
| **9**   | SFU via LiveKit + SFrame E2EE                                                                                                                                                    | 6+ wk    | —              |
| **10**  | Remote control — per-OS, explicit approval, separate design doc                                                                                                                  | —        | —              |

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
