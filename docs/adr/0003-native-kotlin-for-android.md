# ADR-0003 — Android sharer is native Kotlin

**Status:** Accepted · 2026-09-05

## Context

Android sharing needs `MediaProjection`, a foreground service of type
`mediaProjection`, and strict lifecycle ordering — the service must start
_before_ the projection or Android 14+ throws `SecurityException`. Consent
must be re-obtained every session; tokens cannot be cached. Android 15 QPR1+
stops capture on screen lock and gives the user a system chip to kill it.

These rules are fragile and change between Android versions. A cross-platform
abstraction sits between us and the exact APIs whose semantics we must respect.

## Decision

**Native Kotlin with Google's `org.webrtc` (libwebrtc).** No Flutter, no
React Native.

## Consequences

- **Positive:** direct access to the APIs whose behaviour we must handle
  precisely; upstream libwebrtc without a wrapper lagging behind it.
- **Positive:** the app is two screens. A cross-platform framework would earn
  nothing here while adding a layer that fights the platform.
- **Negative:** Android UI is not shared with web/desktop. Accepted — the
  shared surface that matters is `packages/protocol`, and Kotlin types are
  generated from its JSON Schema.
- Viewing on Android needs no app at all; the web viewer covers it.
