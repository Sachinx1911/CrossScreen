# Platform Capability Matrix

> Last verified: **2026-09-05**. Screen-capture APIs change; re-verify before
> committing to any platform date. Sources at the bottom.

The single most important fact in this document:

> **Sharing and viewing are not symmetric capabilities.**
> Viewing works nearly everywhere. Sharing is heavily restricted, and on
> mobile it is impossible from a browser at all.

Every product claim, marketing line, and UI affordance must be derived from
the two tables below — never from the assumption that "if a device can view,
it can share".

---

## 1. Sharer capability

| Platform                                           | Capture API actually used                | Via                       | Status                                       | Hard limits                                                                             |
| -------------------------------------------------- | ---------------------------------------- | ------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| Windows 10 1903+ / 11                              | **Windows Graphics Capture**             | Chromium, inside Electron | ✅ Phase 1                                   | None material                                                                           |
| macOS 13+                                          | **ScreenCaptureKit**                     | Chromium, inside Electron | ✅ Phase 1 (validated Phase 3b)              | Screen Recording permission; user must restart the app after granting it the first time |
| macOS 12 and older                                 | Legacy `CGDisplayStream`                 | Chromium                  | ⚠️ Best-effort                               | Apple deprecated it; do not build features on it                                        |
| Linux — GNOME / KDE on Wayland                     | **PipeWire + `xdg-desktop-portal`**      | Chromium, inside Electron | ✅ Phase 1 (validated Phase 3b)              | Portal picker is drawn by the compositor, not by us — we cannot style or pre-select it  |
| Linux — X11 session                                | X11 capture                              | Chromium                  | ✅ Phase 1                                   | —                                                                                       |
| Linux — wlroots (Sway, Hyprland)                   | PipeWire portal, if one is installed     | Chromium                  | ⚠️ Best-effort, **not a support commitment** | Portal backend varies by install; may be absent entirely                                |
| Desktop browser: Chrome, Edge, Firefox, Safari 17+ | `getDisplayMedia()`                      | The browser               | ✅ Phase 1 — **no install path**             | Safari's picker is more limited; no system audio in Firefox                             |
| **Android 10+**                                    | **`MediaProjection`**                    | **Native app only**       | Phase 4                                      | See §3 — several OS-enforced behaviours users will notice                               |
| **iOS / iPadOS**                                   | **ReplayKit Broadcast Upload Extension** | Native app + extension    | **Deferred to Phase 8**                      | ~50 MB hard memory ceiling on the extension process; see §4                             |
| **Any mobile browser**                             | —                                        | —                         | ❌ **Impossible**                            | `getDisplayMedia()` does not exist on iOS Safari and is not available on Android Chrome |

## 2. Viewer capability

| Platform                                            | Status     | Notes                                            |
| --------------------------------------------------- | ---------- | ------------------------------------------------ |
| Any desktop browser (Chrome, Edge, Firefox, Safari) | ✅ Phase 1 | The primary viewer target                        |
| Android Chrome / Samsung Internet                   | ✅ Phase 1 | Plain web page; no app needed                    |
| iOS / iPadOS Safari                                 | ✅ Phase 1 | Plain web page; H.264 required in the codec list |
| Desktop app                                         | ✅ Phase 1 | Renders the same web viewer                      |

Viewing is a solved problem. **All the engineering risk is on the sharer side.**

---

## 3. Android — the OS rules that shape the UX

These are enforced by the platform. They are product constraints to be
designed around and explained to the user, not bugs to be fixed.

1. **Foreground service must start _before_ `MediaProjection`.** Android 14+
   throws `SecurityException` if the order is reversed. The service must
   declare `FOREGROUND_SERVICE_MEDIA_PROJECTION`.
2. **Consent is required for every single session.** The projection token
   cannot be cached across app restarts, so there is no "remember this
   choice". Every share starts with the system consent dialog.
3. **Capture stops when the screen locks** (Android 15 QPR1+). A user cannot
   start a share and pocket the phone. The UI must warn about this before the
   first share.
4. A **system status chip** lets the user kill the share from outside our app.
   Our UI must handle the stream ending without warning.
5. System audio capture exists on Android 10+, but **individual apps can opt
   out** of being captured. Never promise it will work for a given app.

## 4. iOS — why sharing is deferred

`ReplayKit` broadcasts run in a **Broadcast Upload Extension**: a separate
process with a **hard ~50 MB memory ceiling**. Exceeding it does not degrade
performance — the OS kills the broadcast outright (`replayd` jetsam).

Consequences that make this a sub-project rather than a feature:

- The extension **cannot reach the main app's `RTCPeerConnection`**. Frames
  must either cross a process boundary (App Group + IOSurface + Darwin
  notifications) or a second, miniature WebRTC client must run _inside_ the
  50 MB extension.
- Everything must be tuned to that ceiling: 720p maximum, hardware H.264
  only, 15–30 fps. **VP8 and VP9 are not viable inside the extension.**
- iPad delivers larger frames and routinely blows the 50 MB budget even when
  tuned.
- The user starts a broadcast through the system broadcast picker, not
  through a button we control, so the flow cannot match the other platforms.

**Decision (ADR-0001): iOS is viewer-only in v1.** Revisit in Phase 8.

## 5. System audio — availability is not uniform

| Platform          | System audio             | Notes                                                       |
| ----------------- | ------------------------ | ----------------------------------------------------------- |
| Windows           | ✅ Available             | Via Chromium's loopback capture                             |
| macOS 13+         | ⚠️ ScreenCaptureKit only | Not available on older macOS without a virtual audio driver |
| Linux             | ⚠️ PipeWire-dependent    | Varies by compositor and portal backend                     |
| Android 10+       | ⚠️ Partial               | Apps may opt out of capture                                 |
| iOS               | ❌ Never                 | App audio only, and only within the broadcast               |
| Firefox (desktop) | ❌                       | Not implemented                                             |

**Not in MVP.** Scheduled for Phase 6, Windows first.

## 6. Codec support

| Codec     | Desktop Chrome/Edge | Firefox | Safari | Android                                    | iOS         | Verdict                                                           |
| --------- | ------------------- | ------- | ------ | ------------------------------------------ | ----------- | ----------------------------------------------------------------- |
| **H.264** | ✅                  | ✅      | ✅     | ✅ hardware                                | ✅ hardware | **Mandatory fallback** — the only universal codec                 |
| **VP9**   | ✅                  | ✅      | ✅ 17+ | ✅ mostly                                  | ⚠️ software | **Preferred default** — screen-content coding tools, good text    |
| **VP8**   | ✅                  | ✅      | ✅     | ✅                                         | ⚠️          | Last resort                                                       |
| **AV1**   | ✅                  | ✅      | ⚠️     | ⚠️ hardware decode still rare through 2026 | ⚠️          | Best text compression, ~3–5× VP9 encode cost. **Opt-in, Phase 6** |

Negotiated order: **VP9 → H.264 → VP8.**

---

### Sources

- [Screen capture browser support (getDisplayMedia)](https://cobaltcapture.com/reference/screen-capture-browser-support) · [caniuse: getDisplayMedia](https://caniuse.com/mdn-api_mediadevices_getdisplaymedia)
- [Android: Media projection](https://developer.android.com/media/grow/media-projection) · [Behavior changes: Android 14+](https://developer.android.com/about/versions/14/behavior-changes-14)
- [iOS Screen Sharing: ReplayKit + Broadcast Extension 2026](https://www.forasoft.com/blog/article/how-to-implement-screen-sharing-in-ios-1193) · [Apple Developer Forums — broadcast extension memory](https://developer.apple.com/forums/thread/131210)
- [Wayland screen sharing: XDG portal, PipeWire](https://botmonster.com/self-hosting/wayland-screen-sharing-fix-video-calls-linux/) · [Wayland vs X11 in 2026](https://www.bigiron.cc/guides/wayland-vs-x11-in-2026-what-still-doesnt-work-on-wayland)
- [Comparison of WebRTC codecs for video and screen sharing](https://www.webrtc-developers.com/comparison-of-webrtc-codecs-for-video-and-screen-sharing/)
