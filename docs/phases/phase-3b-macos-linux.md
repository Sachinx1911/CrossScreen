# Phase 3b — macOS and Linux Validation

**Estimate:** 2–3 weeks part-time · **Depends on:** Phase 3a
**Needs:** access to a Mac, and a Linux machine or VM

> **Update, 2026-09-05:** a Mac is now part of the regular development setup —
> the project moves between a Windows PC and a Mac over git. The macOS half of
> this phase is therefore no longer gated on borrowed hardware, and the capture
> and permission checks can be run opportunistically long before Phase 3b
> formally starts. Doing so is cheap and turns a late surprise into an early
> one. Linux remains the part that needs arranging.

## Goal

Promote macOS and Linux from _built but untested_ to _supported_. The code has
existed since Phase 1 (ADR-0009); this phase is verification, permission
handling and packaging — not new features.

## In scope

Real-hardware testing on both platforms · the macOS Screen Recording
permission flow · the Linux portal picker · packaging, signing and
notarisation · an honest, published support list.

## Out of scope

Any new capability. If something turns out to be missing rather than broken, it
becomes its own phase rather than expanding this one.

## Work breakdown

### 3b.1 — macOS

- Verify Chromium's ScreenCaptureKit path on macOS 13 and later.
- The **Screen Recording permission** flow is the real work here. The system
  prompt appears once, and on first grant the app must be restarted before
  capture works. A user who is not guided through this concludes the product is
  broken. Detect the denied state and explain it, rather than failing silently.
- Codesign, notarise and staple. Apple Developer membership and lead time are
  prerequisites, so start this at the beginning of the phase.
- Universal binary for Apple Silicon and Intel.
- Confirm the system-audio limitation from the platform matrix, and make sure
  the UI disables the toggle rather than offering something that cannot work.

### 3b.2 — Linux

- Verify the PipeWire and `xdg-desktop-portal` path on **GNOME and KDE**,
  Wayland and X11. These four combinations are the support commitment.
- The portal's source picker is drawn by the compositor, not by us. Our own
  picker must step aside rather than compete with it, which is a UI difference
  from Windows and macOS.
- Detect a missing portal backend and say so plainly, rather than presenting a
  black frame.
- Package as AppImage first, since it works across distributions without
  packaging each one. Flatpak is a candidate later.
- wlroots compositors such as Sway and Hyprland are tested if convenient but
  remain **explicitly not a support commitment**.

### 3b.3 — Publish the real support list

Update the download page, README and platform matrix with what was actually
verified — including the combinations that were tried and did not work. An
honest list is worth more than an aspirational one, because a user who
downloads a build that cannot work on their desktop does not come back.

## Exit criteria

1. Screen sharing verified on macOS 13+ with the permission flow handled and
   explained.
2. Screen sharing verified on GNOME and KDE, on both Wayland and X11.
3. The macOS build is notarised and opens without a Gatekeeper warning.
4. The AppImage runs on at least two distributions.
5. A missing portal backend produces a clear message, never a black frame.
6. The published support list matches what was tested, with failures named.
7. Phase 2's reconnection cases re-verified on both platforms — sleep and wake
   in particular behaves differently per OS.

## Verification

Manual, on real hardware. A VM is acceptable for Linux; **macOS screen capture
should be verified on real hardware**, since virtualised graphics stacks are
not a fair test of ScreenCaptureKit.

## Risks

| Risk                                                | Mitigation                                                                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| No Mac available                                    | This phase cannot complete without one. Borrow, rent a cloud Mac, or defer the phase — do not ship macOS as supported on the basis of code review |
| Apple notarisation rejects the build                | Start the signing work early in the phase; rejections cost days each                                                                              |
| Wayland behaves differently across compositors      | Support list is narrow and explicit by design                                                                                                     |
| Chromium's capture path changes in a later Electron | Re-run this phase's checks on every major Electron upgrade; add them to the release checklist                                                     |
