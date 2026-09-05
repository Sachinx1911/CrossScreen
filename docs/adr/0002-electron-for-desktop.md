# ADR-0002 — Electron for the desktop client

**Status:** Accepted · 2026-09-05

## Context

The desktop shell choice determines how screen capture works on Windows,
macOS and Linux, and which WebRTC stack we inherit. It is effectively
irreversible. Candidates: Electron, Tauri, Flutter Desktop, native Rust/C++.

Findings:

- **Tauri** uses the system WebView. On macOS that is WKWebView, which
  **does not support `getDisplayMedia`** — precisely the API the product
  exists for. It would require a bespoke Rust capture implementation for
  macOS, plus workarounds on WebKitGTK < 2.42.
- **Native** means writing and maintaining three capture backends and owning
  congestion control, bandwidth estimation and ICE edge cases.
- **Flutter Desktop**'s `flutter_webrtc` screen capture is markedly less
  mature than Chromium's, with weak Wayland support.
- **Electron** bundles Chromium, whose `desktopCapturer` already sits on
  **Windows Graphics Capture**, **ScreenCaptureKit** and the
  **PipeWire/xdg-desktop-portal** path — three platform-native backends,
  maintained by Google, for free — plus a battle-tested libwebrtc.

## Decision

**Electron**, accepting a ~100–150 MB bundle.

## Consequences

- **Positive:** three capture backends and a mature WebRTC stack at zero cost.
- **Positive:** Phases 1/3/4 of the original plan collapse into one (ADR-0009).
- **Positive:** ~90% code reuse with the web viewer; one language across web,
  desktop and backend.
- **Negative:** bundle size and memory. Accepted — bundle size is a download
  page metric; capture correctness _is_ the product. Discord, Slack and
  VS Code Live Share make the same trade for the same reason.
- **Disclosed MVP shortcut:** if Electron ever proves untenable, the escape
  hatch is a Rust core behind the same `ScreenCaptureManager` interface, which
  is defined from day one. Do not attempt this before there is a measured,
  user-reported problem.
