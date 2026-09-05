# Delivery Plan

One file per phase. Each carries the same sections so a phase can be picked
up cold: **Goal · In scope · Out of scope · Work breakdown · Exit criteria ·
Verification · Risks**.

## How much detail each phase gets

Detail is proportional to how soon the work starts. Writing a task breakdown
for Phase 9 today would be fiction — the decisions that shape it have not been
made yet, and half of them depend on what Phases 1–4 teach us.

| Phases | Planning depth                                            | Why                                      |
| ------ | --------------------------------------------------------- | ---------------------------------------- |
| 0 – 3b | **Full** — task-level, with file paths                    | Starting now; this is the MVP            |
| 4 – 7  | **Medium** — deliverables and exit criteria, no task list | Shape is clear, detail would be invented |
| 8 – 10 | **Light** — intent and open questions only                | Too far out to plan honestly             |

Phases 4–7 get their full breakdown at the start of the preceding phase.

## Status

| Phase                  | File                                                           | Estimate | Status                      |
| ---------------------- | -------------------------------------------------------------- | -------- | --------------------------- |
| 0 — Foundation         | [phase-0.md](phase-0.md)                                       | ~1 wk    | ✅ **Done** — 2026-09-05    |
| 0.5 — Walking skeleton | [phase-0.5-walking-skeleton.md](phase-0.5-walking-skeleton.md) | 1–2 wk   | ⏭️ **Next — GO/NO-GO gate** |
| 1 — MVP core           | [phase-1-mvp-core.md](phase-1-mvp-core.md)                     | 8–10 wk  | Planned                     |
| 2 — Reliability        | [phase-2-reliability.md](phase-2-reliability.md)               | 4–5 wk   | Planned                     |
| 3a — Production        | [phase-3a-production.md](phase-3a-production.md)               | 3–4 wk   | Planned                     |
| 3b — macOS + Linux     | [phase-3b-macos-linux.md](phase-3b-macos-linux.md)             | 2–3 wk   | Planned                     |
| 4 — Android sharing    | [phase-4-android.md](phase-4-android.md)                       | 6–8 wk   | Outlined                    |
| 5 — Multi-viewer       | [phase-5-multi-viewer.md](phase-5-multi-viewer.md)             | 2–3 wk   | Outlined                    |
| 6 — Quality + audio    | [phase-6-quality-audio.md](phase-6-quality-audio.md)           | 3–4 wk   | Outlined                    |
| 7 — Teaching Mode      | [phase-7-teaching-mode.md](phase-7-teaching-mode.md)           | 4–6 wk   | Outlined                    |
| 8–10 — Long term       | [phase-8-10-long-term.md](phase-8-10-long-term.md)             | —        | Intent only                 |

**Public MVP = Phases 0 → 3a ≈ 4–6 months part-time.**

## Rules that apply to every phase

1. **A phase is not done until its exit criteria are met.** They are written
   before the work starts, so they cannot be quietly relaxed to fit a
   deadline. If one turns out to be wrong, change it deliberately and say so.
2. **Vertical slices, not layers.** Never build a whole backend before proving
   the path through it. Each phase should end with something demonstrable.
3. **Every shortcut is disclosed.** If something is deliberately unfinished,
   it goes in the phase's _Debt_ section with what replaces it and when —
   never left as a silent surprise for later.
4. **Architecture changes need an ADR.** Not a commit message, not a comment.
5. **Untested is not the same as unsupported.** Anything shipped but not
   verified on real hardware is labelled as such in the UI and the docs.
