# Phase 7 — Teaching Mode

**Estimate:** 4–6 weeks part-time · **Planning depth:** medium

## Goal

The feature that turns screen sharing into teaching, and the product's clearest
differentiator. It is also the point at which the mockup's viewer sidebar —
Pointer, Draw, Chat, Screenshot — finally gets built (ui-scope C6).

## The architectural rule

Interaction data travels over the **WebRTC DataChannel**, never through the
video. Drawing into the captured frame would mean re-encoding, which costs CPU,
adds latency, degrades text and makes annotations impossible to undo.

Channel choice follows the data:

| Data              | Channel                                                    | Why                                                 |
| ----------------- | ---------------------------------------------------------- | --------------------------------------------------- |
| Pointer position  | DataChannel, unordered and unreliable, `maxRetransmits: 0` | A stale cursor position is worse than a dropped one |
| Annotations, chat | DataChannel, ordered and reliable                          | A missing stroke or message is a bug                |
| Presence, control | Existing WebSocket signaling                               | Already there; not latency-critical                 |

DataChannel over WebSocket for the interactive parts because it is peer to
peer: the pointer follows the same path as the video and stays in step with it,
instead of arriving via a server on a different route.

## Deliverables

- **Pointer / laser** — the host's cursor highlighted on the viewer's screen.
  The highest-value item and the one to build first.
- **Annotation** — freehand, arrow, rectangle, text. Rendered on a canvas
  overlay, never composited into the video.
- **Viewer pointer**, so the person being taught can point at what confuses
  them. This is what makes it teaching rather than presenting.
- **Chat** — plain text, DataChannel, no history, no storage.
- **Screenshot** — client-side capture of the current frame, saved locally.
  Never uploaded.
- Clear, per-viewer permissions for who may annotate.

## Exit criteria

1. Pointer latency is indistinguishable from the video's own latency.
2. Annotations survive a reconnection or are cleanly discarded — never
   half-restored.
3. Nothing in this phase re-encodes the video stream.
4. Chat and screenshots are never stored server-side, matching the privacy
   policy written in Phase 3a.
5. The sidebar matches the mockup layout reserved in Phase 1.

## Open questions

- Does annotation persist across a viewer rejoining, or reset?
- Voice: this is where microphone audio starts to matter for teaching, but it
  is a genuinely separate feature. Decide deliberately rather than by drift.

## Risks

| Risk                                                             | Mitigation                                                                                                                                     |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Feature creep towards a full collaboration suite                 | Architecture §13 is explicit: screen sharing is the identity. Pointer and annotation support teaching; they do not become a whiteboard product |
| Annotation coordinates drift when resolution changes mid-session | Store normalised coordinates, never pixels                                                                                                     |
| DataChannel complexity leaks into the video path                 | Keep them in separate modules; the media path must stay untouched                                                                              |
