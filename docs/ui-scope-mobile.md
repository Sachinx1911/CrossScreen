# UI Scope — mobile — mapping the design package to build phases

Source: [`design/mobile/`](design/mobile/) — `CrossScreen_Mobile_App_Design_Spec_v1.0.md`,
the master prompt, the design tokens, and the screen inventory. Supplied
2026-09-08, for Android and iOS.

Same purpose as [`ui-scope.md`](ui-scope.md), which did this for the original
web/desktop mockup: the design package is thorough and mostly sound, but it
was written to the product's *end state*, not to the phase this project is
actually in. This document reconciles the two so nothing gets built against a
screen that cannot work yet — and so the deferred screens are not forgotten.

**Read this before writing a line of Android or iOS UI against the design
package.** ui-scope.md's own rule 1 (Phase 1 risks) applies here unchanged:
_"Scope creep from the mockup's finished-product screens... Anything not
listed there for [the current phase] is out."_

---

## 1. Conflicts with decisions already made

| # | In the design package | Conflict | Resolution |
| --- | --- | --- | --- |
| **M1** | Login/Sign Up, "Continue with Google/Apple", profile avatar, "Sign Out" | ADR-0007: **no accounts in MVP**, on any platform. The spec itself hedges — "Optional for MVP if anonymous sessions are preferred" and "must never block a basic join flow" — but the screen inventory still marks Sign In/Sign Up "Optional MVP" (Priority) rather than out | **Cut entirely for v1**, same as ui-scope.md C2 did for web. No login screen, no avatar, no Sign Out, on Android or iOS. Revisit only if a future phase adds accounts product-wide — not mobile-first |
| **M2** | iOS: full "Share Screen" flow — Entire Screen, Share Options, Broadcast Guidance, Active Sharing as host | ADR-0001: **iOS sharing is deferred to Phase 8.** ReplayKit's Broadcast Upload Extension has a ~50 MB memory ceiling and cannot reach the main app's `RTCPeerConnection` without its own miniature WebRTC client or IPC — this is not a screen away, it is its own sub-project | **iOS ships viewer-only in v1**, per ADR-0001, unchanged. Cut every iOS "Share" screen (I07–I10) from this round. iOS gets Home (Join only), Join Session, Connecting, Viewer, the connection-state screens, Expired Session |
| **M3** | "Devices" screen and bottom-nav item, both platforms, marked flat "MVP" | Device management needs an account to attach devices to — this is M1 wearing a different name. Nothing in the architecture has a device registry | **Cut for v1.** No Devices screen, no "Devices" nav item |
| **M4** | "Enable Annotation" toggle (Share Options); "Chat", "Annotation", "Remote control" (Viewer future controls) | Teaching Mode (pointer, annotation, chat) is **Phase 7**; remote control is **Phase 10**, its own design doc. The design package itself marks these "future" in most places — the toggle on the Share screen is the one spot it slipped through as present-tense UI | **Cut the toggle and the icons from v1 entirely** — do not render them disabled either. ui-scope.md C6 reserved sidebar *space* for these on web because the layout benefited from it; a phone screen does not have space to spare for a control nobody can use yet |
| **M5** | "Share Audio" shown as a live toggle | System audio is **Phase 6**, and `MediaProjection` audio capture is Android 10+ only, with per-app opt-out — not something a v1 Android sharer can promise generally | **Omit from v1.** Not shown, not shown disabled — Android sharing itself isn't built yet (Phase 4 has not started `MediaProjection` wiring), so there is nothing yet to gate a toggle on |
| **M6** | "Specific App" as an Android share option | `MediaProjection` captures the whole display; per-app capture is not a standard Android capability the way per-window capture is on desktop (Chromium's `desktopCapturer`) | **Entire Screen only for v1.** Re-evaluate if a later Android API version makes per-app capture real, not before |
| **M7** | Primary blue `#2563EB` | Web and desktop already ship `--color-brand-500: #2f6fed` ([`apps/web/src/styles/theme.css`](../apps/web/src/styles/theme.css)), a close but different blue | **Use `#2f6fed` on mobile too**, not the design package's value. "Same Experience. Every Device." (the package's own tagline) argues for one brand blue, and the existing one is already shipped, tested, and screenshotted in this project's docs. If `#2563EB` is a deliberate rebrand, that is a decision to make explicitly and apply everywhere at once — not something mobile should drift into unilaterally |

## 2. Screens in v1 scope

Ordered as the user actually moves through them, not as the inventory listed
them.

| Screen | Android | iOS | Notes |
| --- | --- | --- | --- |
| Splash | ✅ | ✅ | Brand + tagline only |
| Onboarding (3 slides) | ✅ | ✅ | Share / Connect / Secure, per the spec |
| Home | ✅ | ✅ (Join only) | Two cards on Android: Share, Join. One on iOS: Join |
| Share — Setup | ✅ | ❌ (M2) | Entire Screen only (M6); no audio (M5), no annotation (M4) |
| `MediaProjection` pre-permission | ✅ | — | Real OS dialog underneath; app never fakes it |
| Active Sharing (host) | ✅ | — | Code, viewer count, duration, Stop |
| Stop Sharing confirmation | ✅ | — | |
| Join Session | ✅ | ✅ | Code entry + paste link, per architecture §7 |
| Connecting / connection states | ✅ | ✅ | See §3 — reuses the protocol's own vocabulary, not new copy |
| Viewer | 🤔 | ✅ | **Open question, not a decision** — phase-4-android.md itself asks whether Android needs to view at all, since the browser already covers it, and says to "resist building a viewer for its own sake." Not built until that is actually decided |
| Expired / error states | ✅ | ✅ | |

Deferred, not cancelled — same convention as ui-scope.md:

- Sign In / Sign Up, Devices (M1, M3) — no phase currently owns these; would need a product decision on accounts first, which nothing in the roadmap currently calls for
- iOS sharing screens (M2) — Phase 8
- Annotation, chat, remote control (M4) — Phases 7 and 10
- Audio toggle (M5) — Phase 6
- Sessions (history) list, Settings, Privacy & Security — plausible **Phase 4** additions once the core loop above works, not blocking it. Web already has a minimal Settings and this is the natural mobile equivalent later

## 3. Connection states — already named, don't rename them

The design package's list (§K/§10 of the spec) — connecting, checking,
establishing secure connection, connected, unstable, reconnecting, failed,
expired, host ended — **is** `ConnectionState` and `session.ended.reason`
from `packages/protocol`, independently arrived at the same vocabulary
architecture §67 already mandates. Good sign, and a reason to import the enum
rather than hand-write new copy:

- `ConnectionState` is already generated in
  [`Protocol.kt`](../apps/android/app/src/main/kotlin/app/crossscreen/android/protocol/Protocol.kt)
  (`CONNECTING`, `CHECKING`, `SECURING`, `CONNECTED`, `UNSTABLE`,
  `RECONNECTING`, `FAILED`) — a status component should switch on that type,
  not a new one.
- "Session expired" / "host ended" map to `EndReason` in the same file.
- Never shown, on any platform: ICE failed, SDP error, DTLS error, TURN
  allocation failed — the design package already says this (§10); it agrees
  with architecture §66 and `errors.ts`'s `USER_MESSAGES`.

## 4. Design tokens adopted

From `design/mobile/CrossScreen_Design_Tokens_v1.0.json`, with M7's correction:

| Token | Value | Note |
| --- | --- | --- |
| Primary | `#2f6fed` | Overrides the package's `#2563EB` — see M7 |
| Success / Warning / Danger | `#10B981` / `#F59E0B` / `#EF4444` | Kept as given; close enough to web's `status-good`/`warn`/`bad` that exact hex reconciliation isn't worth doing until both are looked at together |
| Spacing scale | 4/8/12/16/24/32/48 | Kept as given |
| Radius | 8/12/16/20/pill | Kept as given |
| Motion | 150/200/250ms | Kept as given |
| Android touch target | 48dp | Kept — matches Material 3 guidance already |
| iOS touch target | 44pt | Kept — matches Apple HIG |

Dark theme values kept as given; same rationale as `theme.css`'s own comment —
a screen people watch or share from is used at night as often as not.
