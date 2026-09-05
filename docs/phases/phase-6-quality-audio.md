# Phase 6 — Quality and Audio

**Estimate:** 3–4 weeks part-time · **Planning depth:** medium

## Goal

Improve what the viewer actually experiences, using the measurements collected
since Phase 2 rather than assumptions.

## In scope

### AV1, as an opt-in

AV1 has the best compression for text and the strongest screen-content coding
tools, at roughly 3–5× VP9's encode cost, and hardware decode remains rare on
Android through 2026. So it ships as an opt-in "Sharp text" mode on capable
desktop hardware, with automatic fallback — never as a default that quietly
burns a laptop battery.

### Adaptive quality tuning

Revisit the resolution, frame-rate and bitrate ladders against real data. The
governing principle does not change: **frame rate yields, resolution holds.**
Static content should idle at a low frame rate and spike on change, which is
what makes screen sharing cheap compared with camera video.

### System audio

Per the platform matrix, this is **not uniform** and must not be presented as
though it were:

| Platform  | Plan                                                            |
| --------- | --------------------------------------------------------------- |
| Windows   | Ship first — the only platform where it works straightforwardly |
| macOS 13+ | ScreenCaptureKit path; verify before enabling                   |
| Linux     | PipeWire-dependent; enable only where detected                  |
| Android   | Partial — apps may opt out of capture                           |
| Firefox   | Not available                                                   |

The UI already reads `capabilities().systemAudio`, so the work is detection and
honest disabling rather than new UI.

## Deliverables

- AV1 opt-in with capability detection and fallback.
- Retuned quality ladders backed by measurements.
- System audio on Windows, with per-platform detection everywhere else.
- Microphone as a separate, explicit decision — it is a different feature from
  system audio and should not be bundled with it.

## Exit criteria

1. AV1 is measurably better on text at a fixed bitrate, and its CPU cost is
   documented.
2. AV1 falls back cleanly when hardware or the peer cannot support it.
3. System audio works on Windows and is correctly disabled elsewhere.
4. Quality changes are validated against the Phase 0.5 and Phase 2 baselines —
   not against impressions.

## Risks

| Risk                                                            | Mitigation                                                                             |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| AV1 becomes a battery complaint                                 | Opt-in, on desktop only, with the cost stated in the UI                                |
| Audio is assumed to work everywhere because it works on Windows | Capability detection is mandatory; never render an enabled control that cannot deliver |
