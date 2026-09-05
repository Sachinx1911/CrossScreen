# Phase 0 — Foundation

**Status:** Complete · 2026-09-05 · ~1 day actual (est. 1 week)

## Goal

A repository that makes the architecture legible and the first real code
possible, so that no later phase is spent re-arguing decisions that should
already be settled.

## Delivered

- Git repository initialised and pushed to `Sachinx1911/CrossScreen`.
- `docs/architecture.md` — the governing architecture, marked approved.
- `docs/platform-matrix.md` — per-OS capture capabilities with 2026 sources.
- `docs/roadmap.md` and this delivery plan.
- **9 ADRs** covering every decision that would be expensive to reverse.
- `docs/ui-scope.md` — the supplied design mockup reconciled against those
  decisions: 10 conflicts recorded, 2 missing screens identified.
- pnpm + Turborepo workspace, TypeScript strict base config, Prettier,
  `.gitattributes` for LF normalisation.
- **`packages/protocol`** — Zod schemas as the single source of truth, with
  JSON Schema emitted for the future Kotlin and Swift clients.
- GitHub Actions CI: format, typecheck, test, and a check that the committed
  JSON Schema matches the TypeScript it derives from.

## What the phase taught us

- A test caught that the first draft of `session.viewer.request` accepted
  **any string as a join code** — the format validation had not been wired up.
  That is precisely the class of bug ADR-0006 exists to prevent, found in week
  one rather than in production.
- **Node 26 has dropped corepack**, so pnpm is installed globally instead. CI
  pins Node 24 for an LTS runtime; the plan's "Node 22 LTS" is superseded by
  "an LTS, currently 24".

## Debt carried forward

| Item                                          | Replacement                                            | When                                       |
| --------------------------------------------- | ------------------------------------------------------ | ------------------------------------------ |
| No linter, Prettier only                      | ESLint with typescript-eslint                          | Phase 1, once there is enough code to lint |
| `apps/` and `services/` are empty directories | Filled by Phases 0.5 and 1                             | 0.5                                        |
| No LICENSE file                               | A licence decision is needed before any public release | Phase 3a                                   |
