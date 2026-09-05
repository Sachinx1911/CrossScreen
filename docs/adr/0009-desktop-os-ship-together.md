# ADR-0009 — All three desktop OSes ship from one codebase

**Status:** Accepted · 2026-09-05

## Context
The original plan had Windows, macOS and Linux as three separate phases
(1, 3 and 4). That sequencing assumes each OS needs its own capture
implementation. Given ADR-0002, it does not: Chromium already implements
Windows Graphics Capture, ScreenCaptureKit and the PipeWire portal path, and
selects the right one per platform.

## Decision
**One Electron codebase covers all three desktop OSes, shipped together in
Phase 1.** The three original phases are merged.

Because the developer is solo and part-time with Windows hardware, a *testing*
distinction remains: **Phase 1 validates Windows only.** macOS and Linux are
built and shipped in the codebase but marked *untested* until Phase 3b, when
hardware or VMs are available. This is a testing-scope reduction, not an
architecture change.

## Consequences
- **Positive:** removes roughly two phases of duplicated work.
- **Positive:** platform differences surface as `capabilities()` flags in the
  `ScreenCaptureManager` abstraction rather than as forked code paths.
- **Negative:** untested platforms may ship with defects. **Mitigated** by
  labelling them clearly in the UI and download page until Phase 3b, rather
  than claiming support we have not verified.
- Linux support is scoped to **GNOME and KDE, Wayland or X11**. wlroots
  compositors are best-effort and explicitly not a support commitment.
