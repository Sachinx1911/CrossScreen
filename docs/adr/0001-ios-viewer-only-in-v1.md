# ADR-0001 — iOS is viewer-only in v1

**Status:** Accepted · 2026-09-05

## Context

The product brief asked for symmetric share/view on every platform, including
iPhone and iPad. iOS screen capture is only possible through ReplayKit, which
runs in a **Broadcast Upload Extension** — a separate process with a hard
~50 MB memory ceiling. Exceeding it does not degrade quality; the OS kills the
broadcast. The extension also cannot reach the main app's `RTCPeerConnection`,
so frames must cross a process boundary or a second miniature WebRTC client
must run inside the 50 MB budget. iPad frames are larger and blow the budget
even when tuned.

## Decision

**iOS and iPadOS are viewer-only in v1.** Viewing works today through the web
viewer in Safari with no app at all. iOS _sharing_ becomes Phase 8 with its own
budget and design document.

## Consequences

- **Positive:** removes the single largest source of schedule risk. The effort
  saved exceeds Windows + macOS + Linux + Android combined.
- **Positive:** iOS users still get full value on day one — they can watch.
- **Negative:** the "any device to any device" claim is not true in v1.
  Marketing must say _"Share from your computer, watch on anything."_
- The UI must handle an iOS user reaching a share entry point honestly, not
  with a broken button. See [`../ui-scope.md`](../ui-scope.md) C1.

## Revisit when

There is evidence of real demand for phone-to-desktop teaching, and the
codec/transport path has been proven on Android first.
