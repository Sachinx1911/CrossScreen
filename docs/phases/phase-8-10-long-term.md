# Phases 8–10 — Long Term

**Planning depth: intent only.** These are far enough out that a task
breakdown would be invented rather than planned. Each gets a real plan when its
predecessor completes, and each may be cancelled if the evidence says so.

---

## Phase 8 — iOS Sharing

**Estimate:** 8–12 weeks. **This is a sub-project, not a feature** (ADR-0001).

The constraint that governs everything: a ReplayKit Broadcast Upload Extension
runs in a separate process with a **hard ~50 MB memory ceiling**, cannot reach
the main app's peer connection, and delivers larger frames on iPad that blow
that budget even when tuned.

Consequences to design around rather than fight:

- 720p maximum, hardware H.264 only, 15–30 fps. VP8 and VP9 are not viable
  inside the extension.
- Either a miniature WebRTC client runs inside the extension, or frames cross a
  process boundary via App Group and IOSurface. This choice is the first real
  decision of the phase and deserves its own ADR.
- The broadcast starts from the system picker, not a button we control, so the
  flow cannot match the other platforms.

**Precondition:** revisit only when there is real evidence of demand for
phone-to-desktop teaching, and after Android has proven the mobile path.

---

## Phase 9 — SFU

**Estimate:** 6+ weeks. **Only when a real many-viewer requirement exists.**

LiveKit over mediasoup: it ships as a product with SDKs, is self-hostable, and
leaves far less signaling code to own — which matters a great deal for a solo
developer.

The trade that must be made consciously: **an SFU terminates and re-encrypts
media**, so the "End-to-End Encrypted" badge in the footer becomes false the
moment one is introduced. Either SFrame (WebRTC Encoded Transform) ships
alongside it, or the claim is removed. There is no third option, and this is
recorded here so it cannot be overlooked later.

Do not start this because multi-viewer sounds like the natural next step. Start
it when the mesh cap from Phase 5 is demonstrably the thing blocking users.

---

## Phase 10 — Remote Control

No estimate. Needs its own design document before any estimate is meaningful.

Remote control must be designed **separately for each OS** — there is no single
implementation that can drive Windows, macOS, Linux, Android and iOS. Each has
its own input-injection API and its own security model, and several require
permissions beyond screen recording.

Non-negotiable, whenever it is built:

- Explicit, per-session host approval, separate from view approval.
- A visible, persistent indicator while control is active.
- Instant revocation by the host, reachable at all times.

The abuse considerations from Phase 3a apply with far more force here: remote
control is what tech-support scams actually want. If it is built, it needs
stronger safeguards than viewing, not the same ones.

---

## Things deliberately not on this list

Recording, billing, teams, enterprise SSO and admin consoles. Each may become
worth building, but none of them shape the architecture today, and designing
around them now would add infrastructure the product does not need
(architecture §97).
