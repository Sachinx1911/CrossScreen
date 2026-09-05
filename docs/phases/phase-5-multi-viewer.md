# Phase 5 — Multi-Viewer over P2P Mesh

**Estimate:** 2–3 weeks part-time · **Depends on:** Phase 4 (or straight after 3b)
**Planning depth:** medium

## Goal

Let one host share with **two or three viewers at once** — enough for teaching a
small group, which is the product's stated use case — without introducing an
SFU.

The host opens a separate `RTCPeerConnection` per viewer and encodes once per
connection. This is cheap to build because the signaling already carries
participant identity, and it keeps the end-to-end encryption claim intact: a
mesh has no server in the media path.

## Why a mesh, and where it stops

Uplink cost grows linearly with viewers. At roughly 2 Mbps of screen content,
three viewers need about 6 Mbps of upload, which a typical connection can
manage and a typical CPU can encode. Beyond three or four it stops being
reasonable, and that is the honest boundary of this phase — **not** an argument
for building an SFU now.

The limit is enforced and explained, rather than left to degrade badly:
_"CrossScreen supports up to 3 viewers at a time."_

## Deliverables

- Per-viewer peer connections on the host, created and torn down cleanly.
- Approval flow extended to multiple pending requests without becoming a queue
  the host has to fight.
- Viewer list with per-viewer connection quality, and the ability to remove one.
- A hard cap with a clear message when it is reached.
- Uplink and CPU headroom checks before accepting an additional viewer — refuse
  gracefully rather than degrading the session for everyone already watching.

## Exit criteria

1. Three viewers watch one screen simultaneously with acceptable quality.
2. One viewer leaving or failing does not disturb the others.
3. The host sees per-viewer quality and can remove a viewer.
4. Exceeding the cap produces a clear message, not a degraded session.
5. Host CPU and uplink at three viewers are measured and documented.

## Open questions

- Should the cap adapt to measured uplink rather than being a fixed 3?
- Does the host need a "mute all" or "pause sharing" control at this point?

## Risks

| Risk                                                | Mitigation                                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Mesh is quietly treated as the path to many viewers | It is not. The cap is a feature. Many viewers means an SFU, which is Phase 9 with its own trade-offs |
| Host uplink saturates and every viewer suffers      | Check headroom before accepting, and refuse rather than degrade                                      |
