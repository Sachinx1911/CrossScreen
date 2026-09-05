# Workflows

| Workflow | Runs on                 | What it guards                                                                                                                             |
| -------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `ci.yml` | push to `main`, all PRs | Formatting, lint, types, tests, and that the generated JSON Schema in `packages/protocol/schema` matches the TypeScript it is derived from |

Release and code-signing pipelines arrive in Phase 3a — see
[`../../docs/roadmap.md`](../../docs/roadmap.md).
