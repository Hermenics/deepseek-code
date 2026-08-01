# Code-to-spec matrix

_Re-extracted on 2026-08-01. The matrix maps the 18 current source modules, covering 358 TypeScript/TSX source files. Generated-code, dependency, test, website, and build-artifact files are intentionally outside module-spec coverage._

| Source area | Unit specification | Coverage | Notes |
| --- | --- | --- | --- |
| `src/agent/` | `agent/` | 🟢 | Loop, providers, memory, MCP, session, goals, audit. |
| `src/orchestration/` | `orchestration/` | 🟢 | Task graph, snapshots, events, worktrees, review. |
| `src/tools/` | `tools/` | 🟢 | File/search/shell/web/LSP/subagent/Git/plan/goal tools. |
| `src/commands.ts`, `src/commands/` | `commands/` | 🟢 | Parser, command values and command support. |
| `src/ink/` | `ink/` | 🟢 | Reconciler, output, input, focus, layout. |
| `src/ui/` | `ui/` | 🟢 | App, input, layout, setup, themes, subagent display. |
| `src/plugins/` | `plugins/` | 🟢 | Manifest/source validation and lifecycle. |
| `src/skills/` | `skills/` | 🟢 | SKILL validation, lifecycle, legacy migration. |
| `src/settings/` | `settings/` | 🟢 | Scope merge, validation, persistence, diagnostics. |
| `src/permissions/` | `permissions/` | 🟢 | Rules, risk and authorization explanation. |
| `src/hooks/` | `hooks/` | 🟢 | User-scoped lifecycle shell hooks. |
| `src/services/` | `services/` | 🟢 | Context compaction. |
| `src/entrypoints/`, `src/index.tsx`, `build.ts` | `entrypoints/` | 🟢 | Interactive/headless startup and package build. |
| `src/utils/` | `utils/` | 🟡 | Shared credential, filesystem, terminal, logging, update support. |
| `src/constants/` | `constants/` | 🟢 | Shared defaults and catalogs. |
| `src/types/` | `types/` | 🟢 | Shared provider/theme contracts. |
| `src/bootstrap/` | `bootstrap/` | 🟡 | Startup support and compatibility behavior. |
| `src/native-ts/` | `native-ts/` | 🟢 | Local Yoga-compatible layout implementation. |

## Cross-cutting specifications

| Concern | Source evidence | Specification |
| --- | --- | --- |
| Current structure/dependencies | package, CI, source inventory | `inventory.md`, `dependencies.md` |
| Architecture/integrations | module analysis and Git history | `architecture.md`, C4, ADRs |
| Domain/lifecycle/authority | agent, orchestration, permissions | `domain.md`, `state-machines.md`, `permissions.md` |
| Detailed control flow | 26 Mermaid charts | `flowcharts/` |

Estimated current-source module coverage: **100% at module level**. Fine-grained behavior is traceable to the module design/tasks files and `code-analysis.md`; tests are documented as verification work rather than treated as source specifications. 🟡
