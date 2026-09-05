# CrossScreen — Technical Architecture v1.0

> **Status: APPROVED — 2026-09-05.** This is the governing architecture document.
> Changes to any decision in §12 require an ADR in [`adr/`](adr/) per the change-management
> process, not a silent edit.
>
> Repository: `https://github.com/Sachinx1911/CrossScreen`

---

## Context — why this document exists

Sachin wants to build **CrossScreen**: a cross-platform, real-time screen-sharing product where any supported device can share its screen to any supported viewer, with a link/code join flow and no networking knowledge required. The stated priority is a _production-grade_ architecture that does not require a core rewrite later — not a demo.

The brief (98 sections) is unusually thorough and mostly technically sound. However it contains **four assumptions that are factually wrong or unachievable as written**, and several places where the proposed structure creates avoidable work. This document validates the requirements, corrects those assumptions with current (2026) platform evidence, picks a stack, and defines a phased build order.

**The single most important correction:** the brief treats "share" and "view" as symmetric capabilities on every platform (§6). They are not. Viewing is near-universal; **sharing is heavily platform-restricted**. The whole architecture must be built around that asymmetry.

---

## 1. Requirement validation — what is TRUE, what is WRONG

### ✅ Achievable as specified

- 1-to-1 screen share over WebRTC with STUN + TURN fallback.
- Browser-based viewer with no install, on every target OS and browser.
- Session code + share link join flow, host approval, session expiry.
- Anonymous (no-account) MVP.
- Bidirectional in the sense that _both users can install the sharer app and take turns hosting_.

### ❌ WRONG — must be corrected in the product spec

**W1. "Viewer should preferably view in the browser" ✅ — but "Mobile can share from the browser" ❌**
`navigator.mediaDevices.getDisplayMedia()` is **not supported on iOS/iPadOS Safari at all**, and is **not available on Android Chrome**. Screen capture is a desktop-only web feature in 2026.
→ **Consequence:** _Any_ mobile screen sharing requires a **native app**. There is no web workaround. The brief's §10 "viewer joins in browser" is fine; the implied "Android phone shares via browser" is impossible.

**W2. iOS sharing is not a normal feature — it is a separate sub-project**
iOS screen capture requires **ReplayKit + a Broadcast Upload Extension**, which runs in a **separate process with a hard ~50 MB memory ceiling**; exceeding it means the OS kills the broadcast (`replayd` jetsam). The extension **cannot reach the main app's `RTCPeerConnection`** — you must either run a miniature WebRTC client _inside_ the extension or ship frames over App Group + IOSurface IPC. On iPad the frames are larger and 50 MB is routinely blown.
→ **Recommendation: iOS is VIEWER-ONLY in v1.** iOS _sharing_ becomes a dedicated later phase with its own budget. Shipping it early will consume more engineering time than Windows + macOS + Linux + Android combined.

**W3. A 6-digit session code (§9, `482 719`) is not secure on its own**
1,000,000 combinations is trivially brute-forceable against a public endpoint. The brief correctly demands "sufficient entropy" (§33) and then specifies a code that has ~20 bits.
→ **Fix (see §7):** the 6-digit code stays for UX, but it is _only a lookup key_; it never grants access by itself. Access requires host approval + a separately issued high-entropy viewer token. The **share link carries a 128-bit token**, not the 6-digit code.

**W4. Phases 1/3/4 (Windows → macOS → Linux as separate phases) are wasted effort**
If the desktop client embeds Chromium (see §3), then Windows Graphics Capture, macOS ScreenCaptureKit, and Linux PipeWire/xdg-desktop-portal capture backends are **already implemented and maintained inside Chromium**. Choosing the right desktop shell collapses three phases into one.
→ **Fix:** Phase 1 delivers **all three desktop OSes at once**.

### ⚠️ Needs qualification

- **System audio (§36)** is _not_ uniformly available. Windows: yes. macOS: only via ScreenCaptureKit on macOS 13+. Linux: PipeWire-dependent, patchy across compositors. Android: `MediaProjection` audio on Android 10+, but individual apps can opt out. iOS: app audio only, never true system audio. → **Not MVP.**
- **Linux (§24):** X11 direct capture is effectively dead on Wayland (returns black frames). Only the **PipeWire + xdg-desktop-portal** path is viable. Supported for MVP: **GNOME and KDE Plasma on Wayland, plus X11 sessions**. wlroots (Sway/Hyprland) = best-effort, not a support commitment.
- **Android (§25):** Android 14+ requires the **foreground service to start BEFORE** `MediaProjection` (wrong order → `SecurityException`), requires **fresh user consent for every session** (tokens cannot be cached across restarts), and Android 15 QPR1+ shows a system chip that lets the user kill the share and **auto-stops capture on screen lock**. Sharing therefore cannot survive a locked screen — this is a product constraint, not a bug to fix.

---

## 2. The corrected capability matrix

This replaces §6 of the brief. **Two matrices, not one.**

### Sharer capability (the constrained side)

| Platform                                         | Method                                            | v1 status               |
| ------------------------------------------------ | ------------------------------------------------- | ----------------------- |
| Windows 10/11                                    | Desktop app (Chromium → Windows Graphics Capture) | ✅ Phase 1              |
| macOS 13+                                        | Desktop app (Chromium → ScreenCaptureKit)         | ✅ Phase 1              |
| Linux (GNOME/KDE, Wayland or X11)                | Desktop app (Chromium → PipeWire portal)          | ✅ Phase 1              |
| Desktop browser (Chrome/Edge/Firefox/Safari 17+) | `getDisplayMedia` — **no install**                | ✅ Phase 1 (bonus path) |
| Android 10+                                      | **Native app required** (`MediaProjection`)       | Phase 4                 |
| iOS/iPadOS                                       | Native app + ReplayKit Broadcast Extension        | **Deferred — Phase 7+** |
| Mobile browser                                   | ❌ **Impossible**                                 | Never                   |

### Viewer capability (near-universal — this is the easy side)

| Platform                          | Method            | v1 status  |
| --------------------------------- | ----------------- | ---------- |
| Any desktop browser               | Web viewer        | ✅ Phase 1 |
| Android Chrome / Samsung Internet | Web viewer        | ✅ Phase 1 |
| iOS/iPadOS Safari                 | Web viewer        | ✅ Phase 1 |
| Desktop app                       | Reuses web viewer | ✅ Phase 1 |

**Strategic implication:** the "any device" promise is delivered on the **viewer** side from day one. Sharing rolls out platform by platform. Marketing must say _"Share from your computer, watch on anything"_ until Android ships — not _"any device to any device"_.

---

## 3. The decision that matters most: the desktop shell

The brief (§72) correctly flags this as un-reversible. Three real options:

| Option                                       | Screen capture                                                                                                                                                       | WebRTC stack                                                                                                         | Verdict                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Electron** (Chromium bundled)              | `desktopCapturer` + `setDisplayMediaRequestHandler` → Chromium's own WGC / ScreenCaptureKit / PipeWire backends, **for free, on all 3 OSes**                         | Chromium's libwebrtc: mature bandwidth estimation, simulcast, VP9/AV1 screen-content coding, degradation preferences | ✅ **RECOMMENDED**                                                                          |
| **Tauri** (system WebView)                   | ❌ **macOS WKWebView does not support `getDisplayMedia`.** Requires a bespoke Rust capture implementation for macOS, and WebKitGTK < 2.42 needs workarounds on Linux | Whatever the system WebView ships                                                                                    | ❌ Reject — breaks on the exact feature the product exists for                              |
| **Native (Rust + `webrtc-rs`/Pion, or C++)** | Must write and maintain 3 capture backends                                                                                                                           | Must own congestion control, bandwidth estimation, ICE edge cases                                                    | ❌ Reject for MVP — 6–12 months of work reimplementing what Chromium already does correctly |
| **Flutter Desktop**                          | `flutter_webrtc` desktop screen capture is markedly less mature than Chromium's; Wayland support weak                                                                | Wrapper over libwebrtc, lags upstream                                                                                | ❌ Reject                                                                                   |

**Decision: Electron for the desktop client.**
Yes, the bundle is ~100–150 MB and Tauri is 96% smaller. **That trade is correct here.** We are shipping a screen-sharing product; bundle size is a download-page metric, whereas capture correctness across Windows/macOS/Wayland _is the product_. Electron is what Discord, Slack and VS Code Live Share use for exactly this reason.

**Disclosed MVP shortcut (per §75):** we accept Electron's memory/size cost to get three platform-native capture backends and a battle-tested WebRTC stack for free. Replacement path if ever needed: a Rust core behind the same `ScreenCaptureManager` interface — the abstraction is defined from day one so this stays possible, but it should not be attempted before there is a measured, user-reported problem.

---

## 4. Recommended stack

| Layer              | Choice                                                                                                           | Why                                                                                                                                                                                              | Rejected alternative                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Desktop client     | **Electron 3x + React + TypeScript**                                                                             | Native capture on all 3 OSes for free; shares 90% of code with web viewer                                                                                                                        | Tauri (macOS broken), Flutter (immature capture)                                  |
| Web viewer         | **React 19 + TypeScript + Vite**                                                                                 | Shared component library with desktop app; ecosystem for video UI                                                                                                                                | Vanilla TS — saves little, costs reuse                                            |
| Styling            | **Tailwind CSS**                                                                                                 | Fast, consistent, matches the "clean SaaS" direction in §57                                                                                                                                      | —                                                                                 |
| Android sharer     | **Native Kotlin + `org.webrtc` (Google libwebrtc)**                                                              | `MediaProjection` + foreground-service ordering + Android 14/15 consent rules are fragile; a cross-platform layer fights you here. App is 2 screens — a framework earns nothing                  | Flutter / React Native                                                            |
| iOS                | **Web viewer only in v1**; later Swift + ReplayKit                                                               | See W2                                                                                                                                                                                           | —                                                                                 |
| Backend API        | **Node.js 22 LTS + TypeScript + Fastify**                                                                        | Shares the `protocol` package with web + desktop; I/O-bound workload suits Node; Fastify is lean and production-grade                                                                            | NestJS (unneeded weight for MVP), Go/Rust (no perf need at this scale)            |
| Signaling          | **Node + `ws`**, custom JSON protocol over WSS                                                                   | Socket.IO's reconnection/room features are re-implementable in ~200 lines and its wire format complicates the Kotlin/Swift clients. Plain WebSocket is trivially implementable on every platform | Socket.IO (client-lib lock-in on native)                                          |
| Media              | **WebRTC, P2P first, TURN fallback**                                                                             | Per brief; correct for 1:1                                                                                                                                                                       | SFU in MVP (unjustified)                                                          |
| TURN               | **Cloudflare Realtime TURN** for MVP; coturn later                                                               | Anycast (good for India), TLS/443 out of the box, **first 1 TB/month free** then $0.05/GB, zero ops. Break-even vs self-hosted coturn is around ~5M min/month — far beyond MVP                   | Self-hosted coturn on day 1 (ops burden + single-region latency for zero benefit) |
| Database           | **PostgreSQL 17**                                                                                                | Durable: session events, metrics, abuse logs, (later) accounts                                                                                                                                   | —                                                                                 |
| Live session state | **In-memory Map behind a `SessionStore` interface** for MVP; **Redis** added when signaling scales past one node | Honest answer to §32: **Redis is NOT required for MVP.** The interface makes adding it a swap, not a rewrite                                                                                     | Redis on day 1 (premature)                                                        |
| Deployment         | **Docker Compose on a single VPS (Mumbai region) + Nginx + Let's Encrypt + Cloudflare**                          | Meets §43's "no Kubernetes without a reason"                                                                                                                                                     | Kubernetes                                                                        |
| Monorepo           | **pnpm workspaces + Turborepo**                                                                                  | Android/iOS live in the same repo but outside the pnpm graph (Gradle/Xcode)                                                                                                                      | Multi-repo (protocol drift risk)                                                  |
| Errors / metrics   | **Sentry + Pino structured logs + Prometheus/Grafana (Phase 3)**                                                 | Simple but sufficient per §46                                                                                                                                                                    | OpenTelemetry full stack in MVP                                                   |

---

## 5. System architecture

```
                          ┌──────────────── CONTROL PLANE ────────────────┐
                          │                                                │
   ┌─────────────┐        │   ┌──────────────┐      ┌──────────────────┐  │
   │  SHARER     │        │   │  API         │      │  SIGNALING       │  │
   │             │───────►│   │  (Fastify)   │◄────►│  (ws, WSS)       │  │
   │ Electron    │  HTTPS │   │              │      │                  │  │
   │  (Win/Mac/  │        │   │ sessions     │      │ offer/answer     │  │
   │   Linux)    │◄──WSS──┼──►│ tokens       │      │ ICE candidates   │  │
   │             │        │   │ ICE creds    │      │ approval flow    │  │
   │ Android     │        │   │ rate limits  │      │ presence         │  │
   │  (Kotlin)   │        │   └──────┬───────┘      └────────┬─────────┘  │
   │             │        │          │                       │            │
   │ Desktop     │        │      ┌───▼───────┐      ┌────────▼────────┐   │
   │  browser    │        │      │ PostgreSQL│      │ SessionStore    │   │
   └──────┬──────┘        │      │  (durable)│      │ in-mem → Redis  │   │
          │               │      └───────────┘      └─────────────────┘   │
          │               └────────────────────────────────────────────────┘
          │
          │  ┌──────────────── MEDIA PLANE (never touches control plane) ──┐
          │  │                                                              │
          └──┼──► DTLS-SRTP ──┬──► direct P2P (preferred) ──────────┐      │
             │                │                                     │      │
             │                └──► Cloudflare TURN relay (fallback) ─┤      │
             │                     (relays ciphertext only)          │      │
             └──────────────────────────────────────────────────────┼──────┘
                                                                    ▼
                                                     ┌──────────────────────┐
                                                     │  VIEWER              │
                                                     │  Web app in ANY      │
                                                     │  browser: desktop,   │
                                                     │  Android, iOS        │
                                                     └──────────────────────┘
```

Control plane and media plane share **no** components. Signaling never carries video.

---

## 6. Screen capture abstraction

One interface, platform implementations behind it (per §21):

```ts
interface ScreenCaptureManager {
  listSources(): Promise<CaptureSource[]>; // screens + windows
  start(sourceId: string, opts: CaptureOptions): Promise<MediaStream>;
  stop(): Promise<void>;
  capabilities(): PlatformCapabilities; // systemAudio?, windowPicker?, maxFps
}
```

| Implementation    | Backend                                                                                         | Notes                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `ElectronCapture` | Chromium `desktopCapturer` → WGC (Win) / ScreenCaptureKit (macOS 13+) / PipeWire portal (Linux) | One implementation, three OSes                                                             |
| `BrowserCapture`  | `getDisplayMedia()`                                                                             | Desktop browsers only                                                                      |
| `AndroidCapture`  | `MediaProjection` + `FOREGROUND_SERVICE_MEDIA_PROJECTION`                                       | **Service starts first, then projection.** Fresh consent per session. Stops on screen lock |
| `IOSCapture`      | ReplayKit Broadcast Upload Extension                                                            | Deferred; 50 MB process cap governs the whole design                                       |

`capabilities()` is what the UI reads to decide which buttons to show — the UI never hardcodes platform assumptions.

---

## 7. Session & security model (corrects W3)

```
Host: POST /api/v1/sessions
  → { sessionId: uuid,           // internal, never exposed publicly
      joinCode: "482 719",       // UX convenience, LOOKUP KEY ONLY
      joinToken: <128-bit>,      // goes in the share link
      hostToken: <JWT, 12h>,     // proves host identity on WS
      expiresAt }

Share link:  https://crossscreen.app/j/<joinToken>     ← high entropy
Typed code:  482 719                                    ← low entropy, gated
```

Rules that make the 6-digit code safe:

1. The code **never grants access**. Both paths (code and link) land the viewer in a _pending_ state.
2. **Host approval is mandatory** in MVP (§34). No approval → no SDP is ever exchanged.
3. Rate limits: **5 code attempts / IP / minute, 20 / hour**, exponential backoff; session locks after 10 global failures.
4. Unclaimed sessions expire in **10 minutes**; idle active sessions in **5 minutes** with no participants; hard cap **12 hours**.
5. Viewer receives a per-participant token _after_ approval; it is scoped to one session and one connection.
6. Codes are drawn from a CSPRNG and checked for collisions against active sessions only.

**On extra end-to-end encryption (§41):** not needed for MVP, and here's why — in a 1:1 topology, DTLS-SRTP already gives true end-to-end encryption. TURN relays **ciphertext it cannot decrypt**. Additional E2EE becomes necessary only when an SFU is introduced (Phase 9), because an SFU terminates and re-encrypts media. Plan for **WebRTC Encoded Transform / SFrame** at that point, not before.

**Abuse (§84) — an under-weighted risk in the brief:** public screen-sharing services are a primary vector for tech-support scams. Required in MVP: a persistent, non-dismissible "You are sharing your screen" banner in the sharer app; the viewer count always visible; a one-click Stop; an in-app warning before the first share with an unknown viewer; server-side abuse logging and a report endpoint.

---

## 8. Signaling protocol (draft)

WSS, JSON, one message envelope `{ v: 1, type, id, ts, payload }`.

```
Client → Server                Server → Client
──────────────────────────     ────────────────────────────
session.host.attach            session.state
session.viewer.request         session.viewer.pending
session.viewer.approve         session.viewer.approved | .rejected
session.viewer.reject          peer.joined | peer.left
rtc.offer                      rtc.offer
rtc.answer                     rtc.answer
rtc.ice                        rtc.ice
rtc.restart                    session.ended
stats.report                   error { code, userMessage }
ping                           pong
```

Defined **once** in `packages/protocol` as TypeScript types + JSON Schema; Kotlin/Swift types are **generated** from that schema so the mobile clients cannot drift (§65).

Every error carries a machine `code` **and** a human `userMessage`. Per §66, users see _"Couldn't connect directly — trying another route…"_, never _"ICE failed"_.

---

## 9. Media tuning for screen content

The default WebRTC configuration is tuned for camera video and is **wrong** for screen sharing. Explicit settings:

- `track.contentHint = 'text'` — enables screen-content-coding paths.
- `degradationPreference = 'maintain-resolution'` — **this is the key line.** Under bandwidth pressure, drop frame rate, never resolution. Blurry text is a failed product; 8 fps text is a usable one.
- Codec order: **VP9 → H.264 → VP8.** VP9 has screen-content coding tools and near-universal support. H.264 is the mandatory fallback for Safari and older Android hardware decoders.
- **AV1 is not the MVP default** despite the best text compression: ~3–5× the VP9 encode cost, and hardware decoders remain rare on Android through 2026. Revisit as an opt-in "Sharp text" mode for capable desktops in Phase 6.
- Frame rate: adaptive **5–30 fps**; static content should idle low and spike on change.
- Resolution: cap at 1920×1080; never upscale.

Performance targets, each with a measurement method:

| Metric                                    | Target                   | Measured by                                       |
| ----------------------------------------- | ------------------------ | ------------------------------------------------- |
| Time to start sharing                     | < 2 s p50                | client timestamp, capture-start → first frame     |
| Time to connect (P2P)                     | < 3 s p50                | `session.create` → `iceConnectionState=connected` |
| Glass-to-glass latency (P2P, same region) | 80–200 ms                | on-screen timer captured by viewer camera         |
| Added latency via TURN                    | +30–80 ms                | same, forced-relay mode                           |
| Reconnect after network switch            | < 5 s                    | ICE restart timing                                |
| Sharer CPU (1080p @ 15 fps)               | < 15% of a modern 8-core | OS sampling                                       |

No number here is a marketing figure; all are to be re-baselined from real measurements in Phase 2.

---

## 10. Repository structure

```
crossscreen/
├── apps/
│   ├── web/              # React viewer + landing + join flow (Vite)
│   ├── desktop/          # Electron sharer (reuses packages/ui)
│   └── android/          # Kotlin sharer (Gradle, outside pnpm graph)
├── services/
│   ├── api/              # Fastify: sessions, tokens, ICE creds, rate limits
│   └── signaling/        # ws server (separate process, shares SessionStore)
├── packages/
│   ├── protocol/         # message types + JSON Schema → source of truth
│   ├── webrtc-core/      # peer setup, ICE, stats, reconnection (shared TS)
│   ├── capture/          # ScreenCaptureManager interface + TS impls
│   └── ui/               # shared React components + Tailwind preset
├── infrastructure/       # docker-compose, nginx, migrations, deploy scripts
├── docs/                 # architecture.md, platform-matrix.md, adr/, ...
└── tests/e2e/            # Playwright multi-context connection tests
```

`api` and `signaling` are **separate processes from day one** but deploy on one VPS. Splitting later is then a deployment change, not a refactor.

---

## 11. Phased roadmap (revised for **solo developer, part-time**)

**Constraint accepted:** one developer, part-time (~10–15 hrs/week). Calendar estimates below assume that, and are deliberately conservative. Two consequences that shape the plan:

1. **Nothing gets self-hosted that a free tier can do.** Cloudflare TURN, managed Postgres, Vercel/Netlify for the static viewer — an operations burden is the fastest way to stall a solo project.
2. **Only Windows is validated in Phase 1.** The Electron code is written once for all three OSes (that's why Electron was chosen), but macOS and Linux are _unverified_ until hardware/VMs are available. They stay in the codebase, marked "untested", and get promoted to supported in Phase 3b. This is a testing-scope reduction, **not** an architecture change.

| Phase   | Deliverable                                                                                                                                                                                                             | Calendar (part-time) |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **0**   | Git init + push to `Sachinx1911/CrossScreen`, monorepo scaffold, CI (lint/typecheck), `packages/protocol` v0, `docs/` + ADRs                                                                                            | ~1 week              |
| **0.5** | **WALKING SKELETON — GO/NO-GO GATE.** Hardcoded session, zero UI, no DB: Electron on Windows captures screen → WSS signaling → Chrome on a _different network_ renders it live. Nothing else is built until this works. | 1–2 weeks            |
| **1**   | MVP core: web viewer, session create/join/approve, session lifecycle, Postgres, real error states, sharer + viewer UI per §51–55. Windows validated; macOS/Linux built but untested.                                    | 8–10 weeks           |
| **2**   | Reliability: Cloudflare TURN, forced-relay test mode, ICE restart, Wi-Fi↔mobile reconnection, sleep/wake, stats pipeline, Sentry                                                                                        | 4–5 weeks            |
| **3a**  | Production: rate limiting, abuse controls, expiry jobs, deploy to Mumbai VPS + TLS, Windows code signing, auto-update                                                                                                   | 3–4 weeks            |
| **3b**  | macOS + Linux validation and promotion to supported                                                                                                                                                                     | 2–3 weeks            |
| **4**   | Android sharing (native Kotlin) — first new capability after MVP                                                                                                                                                        | 6–8 weeks            |
| **5**   | Multi-viewer over P2P mesh (2–3 viewers) — no SFU needed                                                                                                                                                                | 2–3 weeks            |
| **6**   | Quality: AV1 opt-in, adaptive tuning, system audio (Windows first)                                                                                                                                                      | 3–4 weeks            |
| **7**   | Teaching Mode — pointer/laser/annotation over **DataChannel** (unreliable+unordered for pointer, reliable for chat); never re-encoded into video                                                                        | 4–6 weeks            |
| **8**   | iOS sharing (ReplayKit) — its own sub-project                                                                                                                                                                           | 8–12 weeks           |
| **9**   | SFU via **LiveKit** — only when a real many-viewer need exists. Chosen over mediasoup because it ships as a product with SDKs; far less signaling code to own solo. Brings SFrame E2EE work with it                     | 6+ weeks             |
| **10**  | Remote control — per-OS, explicit approval, separate design doc                                                                                                                                                         | —                    |

**Realistic read: a shippable public MVP (Phases 0→3a) is roughly 4–6 months of part-time work.** Anyone promising less is not counting reconnection, TURN, and code signing — which is where screen-sharing products actually consume their time.

**Solo-specific scope cuts applied to Phase 1** (each is a _deferral_, not a permanent removal):

- No accounts, no billing, no chat, no recording, no system audio, no annotation.
- No Prometheus/Grafana in MVP — Sentry + structured logs only; metrics stack lands in Phase 3a if needed.
- Landing page is one static page, not a marketing site.

---

## 12. Decisions requiring your approval before coding

| #   | Decision                                                                                                      | Recommendation                                                               |
| --- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| D1  | **iOS sharing deferred to Phase 8; iOS is viewer-only in v1**                                                 | Approve — the 50 MB extension ceiling makes it disproportionately expensive  |
| D2  | **Electron for desktop** (accepting ~150 MB bundle)                                                           | Approve — buys correct capture on Win/macOS/Linux for free                   |
| D3  | **Android sharer is native Kotlin**, not Flutter/RN                                                           | Approve                                                                      |
| D4  | **Cloudflare TURN for MVP**, coturn only past ~5M min/mo                                                      | Approve — behind an `/api/v1/ice-servers` abstraction so switching is config |
| D5  | **No Redis in MVP** (interface-gated, added in Phase 3+)                                                      | Approve                                                                      |
| D6  | **Host approval mandatory** in MVP (fixes the 6-digit-code weakness)                                          | Approve                                                                      |
| D7  | **No accounts in MVP** — fully anonymous sessions                                                             | Approve                                                                      |
| D8  | **Node + Fastify + plain `ws`**, not NestJS/Socket.IO                                                         | Approve                                                                      |
| D9  | **Phases 1/3/4 merged** — all desktop OSes ship together                                                      | Approve                                                                      |
| D10 | **Domain**: `crossscreen.app` availability unverified — needs checking, and the name is not trademark-cleared | Your call                                                                    |

**Confirmed by you (2026-09-05):** D1 approved (iOS viewer-only in v1) · D2 approved (Electron) · team = solo, part-time → §11 timeline and scope adjusted accordingly.

---

## 13. Risk register (living)

| Risk                                              | Sev  | Mitigation                                                                                          |
| ------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------- |
| iOS sharing may never be economically worth it    | High | Deferred; product positioned as "share from computer/Android, watch anywhere"                       |
| TURN bandwidth cost scales with failed P2P        | High | Measure P2P success rate from day one; Cloudflare's 1 TB free tier covers MVP; alert on relay ratio |
| Wayland fragmentation beyond GNOME/KDE            | Med  | Explicit support list; graceful "your desktop isn't supported yet" message                          |
| Android capture dies on screen lock (OS-enforced) | Med  | Product-level: warn the user before sharing; not fixable                                            |
| Electron bundle size hurts install conversion     | Med  | Accepted; measure download→install funnel                                                           |
| Tech-support-scam abuse of the platform           | Med  | Persistent banner, approval flow, abuse logging, report endpoint                                    |
| Protocol drift between TS and Kotlin clients      | Med  | Types generated from one JSON Schema in `packages/protocol`                                         |
| Corporate firewalls blocking non-443              | Low  | TURN over TLS/443 is default, not a fallback                                                        |
| Code signing / notarization cost & lead time      | Low  | Budget in Phase 3; Apple Developer + Windows cert                                                   |

---

## 14. First actions on approval

1. `git init` in `D:\website projects\CrossScreen`, `.gitignore`, `README.md`, initial commit, add remote `https://github.com/Sachinx1911/CrossScreen.git`, push `main`.
2. Create `docs/` with this document as `docs/architecture.md`, plus `docs/platform-matrix.md` and `docs/adr/0001..0009` for D1–D9.
3. Scaffold the pnpm/Turborepo workspace and `packages/protocol` v0.
4. Build **Phase 0.5 walking skeleton** and demo it before writing any more product code.

## 15. Verification

- **Phase 0.5 gate:** two physically separate machines on _different_ networks (one on home Wi-Fi, one on a mobile hotspot) establish a session and render a live screen. Confirmed by reading `RTCPeerConnection.getStats()` for `candidate-pair` type — must show `succeeded`, and the run must be repeated with `iceTransportPolicy: 'relay'` forced to prove the TURN path independently.
- **Per-phase:** Playwright multi-browser-context E2E for the full create → join → approve → connect → leave flow; unit tests on `packages/protocol` schema round-trips; manual matrix run against the platform table in §2 before each release.
- **Network conditions:** verify under simulated 3% packet loss and 200 ms RTT (Chrome DevTools throttling + `tc netem` on Linux) that video degrades in frame rate, not resolution.

---

### Sources for the 2026 platform claims

- [Screen capture browser support (getDisplayMedia)](https://cobaltcapture.com/reference/screen-capture-browser-support) · [caniuse: getDisplayMedia](https://caniuse.com/mdn-api_mediadevices_getdisplaymedia)
- [iOS Screen Sharing: ReplayKit + Broadcast Extension 2026](https://www.forasoft.com/blog/article/how-to-implement-screen-sharing-in-ios-1193) · [Apple Developer Forums: broadcast extension memory](https://developer.apple.com/forums/thread/131210)
- [Wayland screen sharing: XDG portal, PipeWire](https://botmonster.com/self-hosting/wayland-screen-sharing-fix-video-calls-linux/) · [Wayland vs X11 in 2026](https://www.bigiron.cc/guides/wayland-vs-x11-in-2026-what-still-doesnt-work-on-wayland)
- [Android: Media projection](https://developer.android.com/media/grow/media-projection) · [Behavior changes: Android 14+](https://developer.android.com/about/versions/14/behavior-changes-14)
- [Comparison of WebRTC Codecs for Video and Screen Sharing](https://www.webrtc-developers.com/comparison-of-webrtc-codecs-for-video-and-screen-sharing/) · [Screen Sharing with WebRTC and LiveKit: Finding the Best Encoder](https://www.gethopp.app/blog/screensharing-encoders-compared)
- [Tauri v2 / wry release notes](https://v2.tauri.app/release/wry/) · [Tauri vs Electron 2026](https://tech-insider.org/tauri-vs-electron-2026/)
- [Cloudflare Realtime TURN](https://developers.cloudflare.com/realtime/turn/) · [Coturn vs Cloudflare 2026](https://callsphere.ai/blog/vw3e-webrtc-turn-scaling-coturn-vs-cloudflare-2026)
- [Choosing an SFU: mediasoup, Janus, LiveKit, Pion](https://www.forasoft.com/learn/video-streaming/articles-streaming/sfu-comparison-mediasoup-janus-livekit-jitsi-pion)
