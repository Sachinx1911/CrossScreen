# Getting CrossScreen to a person

A working build is not a delivered product. Between `pnpm build` and someone
actually looking at a shared screen there is a queue of gatekeepers — operating
systems, browsers, app stores — each of which can stop the software cold, and
most of which take days rather than minutes to satisfy.

This document lists them per platform, so the slow ones can be started early
instead of discovered late. Costs live in [`cost-model.md`](cost-model.md);
this is about what stands in the way and how long it takes to clear.

---

## 1. The browser sharer — nothing stands in the way

This is the whole argument of [ADR-0010](adr/0010-browser-sharer-is-the-primary-path.md).
A URL is opened, `getDisplayMedia()` is called, the browser asks the user what
to share. No installer, no certificate, no store, no review, no per-OS build.
Windows, macOS and Linux are reached in the same deploy.

What it does need, and none of it is a gate:

| Requirement              | Why                                                                                             | Handled by            |
| ------------------------ | ----------------------------------------------------------------------------------------------- | --------------------- |
| HTTPS                    | `getDisplayMedia` needs a secure context; on plain HTTP `navigator.mediaDevices` is `undefined` | Any static host, free |
| A user gesture           | Browsers refuse screen capture that was not started by a click                                  | Product design        |
| The browser's own picker | We cannot choose the screen for the user, and should not want to                                | Product design        |

Known limits, which belong in the UI rather than in a surprise:

- **Safari is the weak corner.** `getDisplayMedia` arrived in Safari 17 and
  behaves least consistently there. Chrome, Edge and Firefox on desktop are the
  support commitment; Safari is best-effort and should be labelled so, exactly
  as Linux compositors are.
- **No mobile browser can share.** Not iOS Safari, not Android Chrome. This is
  not a gap to work around; there is no workaround. Mobile sharing is the
  native Android app in Phase 4.
- **The viewer must autoplay.** A remote stream will not start without
  `autoplay`, `muted` and `playsinline` on the video element — already
  established in Phase 0.5 and easy to lose in a rewrite.

---

## 2. Windows desktop app

| Gate                     | What happens without it                                                                            | Lead time                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Code signing certificate | SmartScreen: _unrecognised app, might harm your computer_                                          | **Days to weeks** — identity validation, then a FIPS token shipped and cleared through customs |
| SmartScreen reputation   | Even signed, a brand-new certificate carries no reputation and may warn until downloads accumulate | Weeks of real downloads; EV certificates start with reputation, at a higher price              |
| Auto-update              | Users stay on the version they first installed, including its bugs                                 | Phase 3a                                                                                       |

The certificate is the single slowest thing in the entire plan, and it is slow
for reasons no amount of effort compresses. **Start it, do not schedule it.**

## 3. macOS desktop app

| Gate                                | What happens without it                                                                                                             | Lead time                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Apple Developer Program             | No Developer ID certificate, so nothing below is possible                                                                           | Hours to days to enrol                         |
| Developer ID signing + notarisation | Gatekeeper does not warn — it **refuses to open the app**                                                                           | Minutes per build once enrolled                |
| Hardened runtime                    | Notarisation rejects the build                                                                                                      | Build configuration                            |
| Screen Recording permission         | Capture returns nothing, and **the grant does not apply to an already-running process** — the app must be restarted before it works | Runtime; a product problem, not a shipping one |

That last row is the one users experience as "this app is broken". Phase 3b
treats the permission flow as the real work rather than the capture itself, and
[`dev-setup.md`](dev-setup.md) records how it caught us during development.

## 4. Linux desktop app

No signing authority to satisfy — the friction is fragmentation instead.

- **Only the PipeWire + xdg-desktop-portal path works.** X11 direct capture
  returns black frames under Wayland.
- **GNOME and KDE Plasma are the support commitment**, on Wayland and X11.
  wlroots compositors such as Sway and Hyprland are best-effort, and should say
  so in the UI rather than fail confusingly.
- **Packaging is a choice, not a given.** AppImage asks nothing of the user and
  nothing of us; Flatpak reaches more people and adds portal permissions to get
  right. AppImage first is the smaller commitment.

## 5. Android (Phase 4)

| Gate                          | Detail                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Google Play Developer account | $25 once                                                                                                                       |
| Play review of screen capture | Screen-recording permissions attract scrutiny; the privacy disclosure has to be prepared early. A rejection costs about a week |
| Foreground service ordering   | Android 14+ throws `SecurityException` if `MediaProjection` starts before the foreground service                               |
| Consent per session           | Tokens cannot be cached across restarts; the user consents every time                                                          |
| Screen lock stops capture     | Android 15 QPR1+ auto-stops on lock. **Not fixable** — warn the user before they start                                         |

Sideloading an APK avoids Play entirely and is a reasonable way to get the
first testers, with the reach limit understood.

## 6. iOS (Phase 8, sharing) — viewing works today

Viewing needs nothing: iOS Safari opens the link like any browser, and that
half of the promise is delivered from day one.

Sharing is a separate sub-project, for reasons recorded in
[ADR-0001](adr/0001-ios-viewer-only-in-v1.md): ReplayKit's Broadcast Upload
Extension runs in its own process under a hard ~50 MB ceiling, cannot reach the
main app's `RTCPeerConnection`, and on iPad the frames are large enough that
the ceiling is routinely hit. App Store review of a broadcast extension is
correspondingly careful.

---

## 7. What to start early

Ordered by how little the calendar can be argued with:

1. **Windows code signing** — weeks, mostly waiting on other people. The moment
   the desktop app is genuinely next, begin.
2. **Domain** — cheap and quick, but nothing may be signed, printed or
   published under the name until it is settled ([D10](architecture.md#12-decisions-requiring-your-approval-before-coding)).
3. **Apple Developer enrolment** — days, and blocks both macOS and any future
   iOS work.
4. **Play Console** — needed only when an APK is ready for strangers.

Everything else is engineering, and engineering answers to effort.
