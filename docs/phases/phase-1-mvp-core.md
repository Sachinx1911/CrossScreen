# Phase 1 — MVP Core

**Estimate:** 8–10 weeks part-time · **Depends on:** Phase 0.5 passing its gate

## Goal

The complete product loop, working, for one sharer and one viewer:

> Start Sharing → get a code and link → friend opens the link → **host approves**
> → screen appears → either side leaves cleanly.

Windows is validated. macOS and Linux are built from the same codebase but
carry an "untested" label until Phase 3b (ADR-0009).

## In scope

Sessions with real lifecycle · join by code and by link · **mandatory host
approval** · the persistent sharing indicator and first-share notice ·
PostgreSQL for durable events · user-facing error states · recent sessions in
`localStorage` · the design system extracted from the mockup · Playwright
end-to-end coverage of the whole loop.

## Out of scope

TURN credential issuing and reconnection (Phase 2) · rate limiting and abuse
controls (Phase 3a) · accounts, chat, annotation, recording, system audio,
remote control · anything cut in [`../ui-scope.md`](../ui-scope.md).

## Work breakdown

Ordered so that something is demonstrable at the end of each slice, rather
than building all of one layer before any of the next.

### 1.1 — Session lifecycle · `services/api`

Fastify, TypeScript, Zod validation shared from `@crossscreen/protocol`.

| Endpoint                      | Purpose                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `POST /api/v1/sessions`       | Create. Returns joinCode, joinToken, hostToken, expiresAt                                   |
| `GET /api/v1/sessions/lookup` | Resolve a code or token to a session id. **Returns existence only, never session contents** |
| `GET /api/v1/ice-servers`     | Static config in this phase; short-lived credentials in Phase 2                             |
| `GET /healthz`                | Liveness                                                                                    |

Identifier generation per architecture §7: sessionId a UUID that never leaves
the server, joinCode six CSPRNG digits checked against active sessions only,
joinToken 128 bits base64url, hostToken a 12-hour JWT.

### 1.2 — SessionStore interface · `services/signaling`

One interface, one in-memory implementation (ADR-0005). Every access to live
session state goes through it, so the Redis implementation in Phase 3a is a
swap rather than a rewrite. Timeout sweeping lives here, driven by
`SESSION_TIMEOUTS`.

### 1.3 — Real signaling · `services/signaling`

Replaces the Phase 0.5 hardcoded room.

- `session.host.attach` validates the host token and binds the socket as host.
- `session.viewer.request` resolves a code or token, creates a **pending**
  participant and notifies the host. **No SDP is relayed at this point.** This
  is the mechanism ADR-0006 rests on, and the place to be most careful.
- `session.viewer.approve` and `.reject` are host-only; the server enforces the
  role rather than trusting the client. Approval issues the per-participant
  token and only then opens the relay between those two peers.
- Presence, heartbeats, peer joined and left, session ended.
- Pending requests auto-reject after `SESSION_TIMEOUTS.joinRequestMs`.

### 1.4 — PostgreSQL · `services/api`

Durable data only. **Live session state stays in memory** — the database is not
in the signaling hot path.

| Table              | Contents                                                           |
| ------------------ | ------------------------------------------------------------------ |
| `session_events`   | created, joined, approved, rejected, connected, ended, with timing |
| `connection_stats` | periodic quality samples, including the direct-versus-relay flag   |
| `abuse_log`        | failed code attempts, lock events, reports                         |

Migrations run on start in development and explicitly in production. No ORM;
`postgres.js` with hand-written SQL is enough at this size and keeps the query
plan visible.

**Privacy:** no screen content, no audio, and no full IP addresses — store a
truncated or hashed IP for rate limiting and nothing more (architecture §42).

### 1.5 — `packages/webrtc-core`

The peer logic shared by web and desktop, promoted from the Phase 0.5 helper.

- `PeerSession`: offer/answer, ICE, track handling, teardown.
- Codec preference and media defaults applied in one place, so the desktop and
  browser sharers cannot drift apart.
- A stats poller mapping raw `getStats()` onto `ConnectionQuality` and
  `ConnectionState` from the protocol package.
- The state machine that turns ICE states into the seven user-facing states in
  architecture §67 — so that no client ever renders "ICE failed".

### 1.6 — `packages/capture`

`ScreenCaptureManager` (architecture §6) with `ElectronCapture` and
`BrowserCapture`. `capabilities()` is what the UI reads to decide which
controls to show; no component may branch on platform directly.

### 1.7 — `packages/ui`

Design tokens extracted from the mockup (see [`../ui-scope.md`](../ui-scope.md)
§4): the blue primary, card surfaces, the grouped tabular session code, the
status dot with words beside it. **Light and dark palettes both**, even though
the mockup shows only light — the viewer is often used at night.

### 1.8 — Web app · `apps/web`

Landing · Join (code entry and paste link) · Viewer · a minimal Settings.

Viewer chrome in this phase: connection state, quality, fullscreen, leave. The
Chat, Draw, Pointer and Screenshot icons stay out (ui-scope C6), but the
sidebar layout reserves their space so Phase 7 is not a redesign.

### 1.9 — Desktop app · `apps/desktop`

Share (source picker with preview) · active-sharing state · Join · Settings.

Two screens that are **not in the mockup** and must be designed
([`../ui-scope.md`](../ui-scope.md) §3):

- **The host approval prompt.** Shows device, browser and coarse location so
  the host can tell whether this is the person they sent the link to. Reject is
  the default on timeout.
- **The persistent sharing indicator**, plus the one-time first-share safety
  notice. Non-dismissible, viewer count always visible, one-click stop.

Also from ui-scope: the audio toggle defaults **off** and is disabled where
`capabilities().systemAudio` is false (C4), and the quality toggle ships as
**"Optimise for text clarity", on by default** (C5).

### 1.10 — End-to-end tests · `tests/e2e`

Playwright with two browser contexts: create, join, approve, connect, leave.
Plus the paths that matter most for safety — join rejected, join timed out,
session expired, host ends mid-session.

> **Verified end to end, 2026-09-06.** Browser sharer to browser viewer:
> session created, code and link shown, host prompted, approved, video flowing
> at 960x540 on VP9. Driven with a canvas-backed `MediaStream` in place of a
> real screen, because the automation sandbox refuses the capture permission —
> every other part of the path is the real one.
>
> **Slice 1.9 done, 2026-09-06.** The desktop app runs on the same
> `SharerSession` as the browser, so the approval ordering cannot drift between
> the two shells. It also gained the source picker, which is the thing it
> exists for: a browser can only offer whatever dialog it draws.
>
> Distribution still waits on code signing (ADR-0010), so this is the
> better-experience path rather than the way in.

### 1.11 — ESLint

Added once there is enough code for it to earn its keep (Phase 0 debt).

## Exit criteria

1. A stranger can be walked through the whole flow without explanation.
2. **No SDP is exchanged before the host approves.** Verified by test, not by
   reading the code.
3. Every error surfaces in plain language; no jargon reaches the interface.
4. A session expires on schedule and both sides are told why.
5. The viewer works in Chrome, Edge, Firefox and Safari, and on Android and
   iOS browsers.
6. Text in a shared spreadsheet is legible at 1080p on a normal connection.
7. Playwright covers the full loop and the four failure paths.
8. macOS and Linux builds compile and are labelled untested.

## Verification

Playwright for the loop and failure paths; unit tests on session identifier
generation, expiry arithmetic and the state machine; manual runs against the
browser matrix; and one unscripted walkthrough with a real person who has not
seen the product before.

## Risks

| Risk                                                                           | Mitigation                                                                |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Scope creep from the mockup's finished-product screens                         | ui-scope.md is the contract. Anything not listed there for Phase 1 is out |
| The approval step feels slow enough to tempt a "remember this viewer" shortcut | Do not add one. It reintroduces exactly the weakness ADR-0006 removes     |
| Eight to ten weeks part-time is a long stretch without a demo                  | Each slice ends demonstrable; do not batch them                           |
| Safari-specific WebRTC behaviour found late                                    | Test Safari from slice 1.8 onward, not at the end                         |
