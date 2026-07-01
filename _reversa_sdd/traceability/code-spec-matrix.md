# Code-Spec Traceability Matrix

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Source Module → SDD Artifact Mapping

| Source Module | Files | SDD Artifacts |
|--------------|-------|---------------|
| `src/agent/` | agent.ts, config.ts, llmClient.ts, memory.ts, steering.ts, promptRefiner.ts, history.ts, checkpoint.ts, fileCheckpoint.ts, compactBoundary.ts, cost.ts, auditLog.ts, mcp.ts, files.ts | code-analysis.md, data-dictionary.md, flowcharts/agent.md, domain.md (R01-R03, R15-R16, INV-01-02), state-machines.md (SM-08), architecture.md |
| `src/agent/providers/` | bedrock.ts, vertex.ts, proxy/ | code-analysis.md, c4-containers.md (Provider Layer, Browser Proxy), c4-components.md (Proxy), ADR-003 |
| `src/tools/` | Shell, ReadFile, WriteFile, PatchFile, ReadFolder, Glob, Grep, Git, WebFetch, SubAgent, Todo, Introspect, MoA, UpdateKnowledge | code-analysis.md, flowcharts/tools.md, domain.md (R09-R11, R13, R17-R18, R21), permissions.md (matrices), c4-components.md (Tool Registry) |
| `src/tools/shared/` | pathSafety.ts | domain.md (R09), permissions.md (Path Sandbox), ADR-009 |
| `src/tools/SubAgent/` | permissions.ts, memory.ts, SubAgent.ts | domain.md (R02, R14), state-machines.md (SM-02), permissions.md (SubAgent Role matrix), ADR-008 |
| `src/tools/MoA/` | types.ts, defaults.ts, executor.ts, index.ts | domain.md (R21), data-dictionary.md (MoA types), erd-complete.md (MoAConfig) |
| `src/tools/WebFetch/` | WebFetch.ts | domain.md (R10), permissions.md (SSRF Protection) |
| `src/permissions/` | types.ts, matcher.ts, risk.ts | domain.md (R06-R08, R11, R22), flowcharts/permissions.md, state-machines.md (SM-03, SM-06, SM-07), permissions.md, ADR-007 |
| `src/hooks/` | types.ts, matcher.ts, executor.ts, useToolPermission.ts | domain.md (R05, R19-R20), flowcharts/hooks.md, state-machines.md (SM-05), ADR-005 |
| `src/settings/` | types.ts, index.ts | domain.md (R05, R12), flowcharts/settings.md, permissions.md (Settings Security Model) |
| `src/ui/` | App.tsx, interactionMode.ts, theme.ts, input/, messages/, subagent/, layout/ | domain.md (R08), flowcharts/ui.md, state-machines.md (SM-01), c4-components.md (TUI Layer), ADR-006 |
| `src/ink/` | All custom Ink renderer files | c4-components.md (TUI Layer), ADR-002 |
| `src/commands/` | 26 command modules | data-dictionary.md (CommandResult), c4-containers.md (Command Router) |
| `src/services/compact/` | autoCompact.ts, summaryPrompt.ts | domain.md (R03), state-machines.md (SM-04), c4-containers.md (Compaction Service) |
| `src/state/` | store.ts, selectors.ts | data-dictionary.md (AppState), erd-complete.md (AppState) |
| `src/constants/` | agent.ts, tools.ts, product.ts, ui.ts | domain.md (all constants referenced), data-dictionary.md |
| `src/context/` | AppContext.ts | data-dictionary.md (AppContextValue) |
| `src/types/` | provider.ts | data-dictionary.md (ProviderConfig, ThemeName), erd-complete.md |
| `src/remote/` | bridge, pairing, session, devices, qr, adapter | domain.md (Remote Control glossary), c4-context.md, c4-containers.md (Remote Control) |
| `src/entrypoints/` | cli.tsx, pipe.ts | c4-containers.md (CLI Entrypoint), flowcharts/ui.md |

---

## Domain Rule → Source Code Tracing

| Rule ID | Rule Name | Source File(s) | Line(s) |
|---------|-----------|---------------|---------|
| R01 | Agent Iteration Limit (100) | src/agent/agent.ts | 712-716 |
| R02 | SubAgent Iteration Limit (15) | src/constants/tools.ts | 14 |
| R03 | Auto-Compact Threshold (0.85) | src/constants/agent.ts | 5 |
| R04 | Memory Size Cap (2000) | src/agent/memory.ts | 6 |
| R05 | Hooks Only From User Settings | src/settings/index.ts | stripHooks() |
| R06 | Deny-First Permission Resolution | src/permissions/matcher.ts | 89-116 |
| R07 | Risk Confirmation in Build Mode | src/permissions/risk.ts | 118 |
| R08 | Auto Mode Bypasses All | src/agent/agent.ts | 1028 |
| R09 | Path Sandbox Enforcement | src/tools/shared/pathSafety.ts | 61-100 |
| R10 | SSRF Protection | src/tools/WebFetch/WebFetch.ts | 11-87 |
| R11 | Glob Wildcard Safety (10 max) | src/permissions/matcher.ts | 20-21 |
| R12 | Settings Merge Priority | src/settings/index.ts | mergeSettings() |
| R13 | Parallel Tool Execution | src/agent/agent.ts | 50 (PARALLEL_SAFE set) |
| R14 | SubAgent Role Inference | src/tools/SubAgent/permissions.ts | 31-50 |
| R15 | Undo Stack Limit (10) | src/constants/agent.ts | 2 |
| R16 | Prompt Refinement Guards | src/agent/promptRefiner.ts | conditional checks |
| R17 | Shell Output Truncation (50k) | src/constants/tools.ts | 2 |
| R18 | Shell Command Timeout (30s) | src/constants/tools.ts | 5 |
| R19 | Hook Timeout (30s default) | src/hooks/executor.ts | 10 |
| R20 | PostToolUse Result Cap (10k) | src/hooks/executor.ts | 116 |
| R21 | MoA Minimum Responses | src/tools/MoA/defaults.ts | 13 |
| R22 | Content-Scoped Risk Approval | src/agent/agent.ts | 1056-1059 |
| R23 | Checkpoint Max (20) | src/constants/agent.ts | 13 |

---

## ADR → Source Code Tracing

| ADR | Primary Source Files |
|-----|---------------------|
| ADR-001: Bun as Runtime | package.json, bunfig.toml, bun.lock |
| ADR-002: Fork Ink | src/ink/ (entire directory) |
| ADR-003: Remove OAuth | src/types/provider.ts, src/agent/llmClient.ts |
| ADR-004: Remove Medium Effort | src/commands/types.ts:2 |
| ADR-005: Hooks User-Only | src/settings/index.ts (stripHooks) |
| ADR-006: Interaction Modes | src/ui/interactionMode.ts |
| ADR-007: Content-Scoped Risk | src/agent/agent.ts:1056-1076 |
| ADR-008: SubAgent Roles | src/tools/SubAgent/permissions.ts |
| ADR-009: Path Sandbox | src/tools/shared/pathSafety.ts |
| ADR-010: Remove Language | commit 400b4fb (removed feature) |
