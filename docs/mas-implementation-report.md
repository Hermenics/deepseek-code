# MAS Orchestrator — Implementation Report

Date: 2026-07-18  
Baseline HEAD: `3e96e4f7433ffd7f0e9c9a78781ba268e8bb62d7` (`main`)  
Delivery status: P0 and P1 implemented as a production-oriented vertical slice; the MoA, independent-review, declarative-agent and context-isolation portions of P2 are also implemented.

## Executive result

DeepSeek Code now gives every `Agent` an isolated `OrchestratorSession` with a concurrency-safe task registry, validated lifecycle, DAG scheduling, observable handles, cancellation, timeout, bounded retry, structured mailboxes, strict result schemas, fail-closed verification, persistent recovery and safe writer workspaces.

The implementation is incremental and clean-room. Existing CLI and foreground flows remain available, while unsafe global scheduling/memory modules and implicit shared-writer behavior were removed. No commit, push, pull request, repository clone or modification of `/home/marcelo/claude-code-source` was performed.

## Baseline and confirmed diagnosis

Before editing, the worktree was clean. `bun run typecheck` and `bun run build` passed. The baseline `bun test` result was 1265 passing, 3 skipped and 1 failing: the existing `grep` timeout in `tests/tools.test.ts`.

The following hypotheses were confirmed in the baseline and addressed:

- Mutable SubAgent concurrency and turn-memory state lived in process-global modules under `src/tools/SubAgent/concurrency.ts` and `src/tools/SubAgent/memory.ts`. They are removed; ownership now belongs to `src/orchestration/OrchestratorSession.ts`.
- Background delegation in `src/tools/AskAgent/AskAgent.ts` returned an acknowledgement without a controllable task handle. It now returns a versioned handle containing session and task identity.
- The previous SubAgent contracts in `src/tools/SubAgent/contracts.ts` extracted JSON from free-form Markdown and verification could turn internal failure into approval. Terminal results now use schema-validated private tools in `src/tools/SubAgent/executor.ts`; verification is fail-closed in `src/tools/SubAgent/verification.ts`.
- Agent and subagent execution had no uniform abort context. `src/agent/agent.ts`, provider calls and context-aware tools now propagate `AbortSignal` and distinct cancellation/timeout outcomes.
- Writer delegation could operate on the same checkout, and `src/agent/worktree.ts` had an unsafe copy fallback. Writers now use isolated Git worktrees or an explicit serialized lease; interactive worktrees require Git.
- Authorization could evaluate pre-hook arguments, treat `ask` too permissively or authorize paths before canonical containment. The agent/runtime tool pipeline now evaluates effective arguments, blocks on `ask`, validates paths first and records decisions.
- The MoA implementation could hide candidate failure and silently use the first candidate when synthesis failed. `src/tools/MoA/executor.ts` now preserves labeled candidate outcomes and has a separate, mandatory synthesis stage.
- Agent definitions were not fully connected to runtime constraints after inheritance. `src/agent/config.ts` now validates the resolved definition and applies its profile, tools, timeout, retry, delegation, context and budget settings.

## Architectural decisions

### Session ownership

`Agent` constructs one `OrchestratorSession`. The session owns its registry, scheduler, mailbox, event sink, workspace manager, memory scope and optional snapshot store. There is no mutable global task registry.

### Lifecycle and completion

`TaskRegistry` implements the explicit states `queued`, `running`, `blocked`, `done`, `failed`, `cancelled` and `timed_out`. Every transition is checked against the state machine. Completion is compare-and-set by task and attempt; late or duplicate completion fails explicitly. Cancellation is idempotent.

Cancelled and timed-out callers receive their terminal envelope promptly, but a non-cooperative runner retains its scheduler permit until its promise settles. This prevents hidden concurrency after an abort.

### DAG and limits

Dependencies are session-local task IDs. Spawn and dependency mutation validate existence and cycles before changing state. Ready work is backpressured by per-session concurrency. Dependency failure can block, fail or cancel dependents; parent cancellation can cascade or detach.

Defaults are concurrency 5, total tasks 17, depth 2, fan-out 5, retry 1 and timeout 120 seconds. Limits can only be narrowed by runtime/declarative configuration. Reliable provider metrics are retained; unknown cost is not estimated.

### Structured protocols

Task records, result envelopes, messages, events and snapshots use versioned V1 schemas. Ajv is a direct runtime dependency. Subagents must make exactly one `submit_result` terminal call. Verifiers must make exactly one `submit_verification` call, and only `CONFIRMED` approves. Invalid, missing, repeated or mixed output is preserved diagnostically, retried once and then fails.

### Least privilege

The runtime applies `researcher-readonly`, `tester`, `writer-worktree` and `coordinator-integrator` profiles before project rules. Delegated configs cannot claim the coordinator profile. Effective capabilities are the intersection of the profile, agent allowlist and parent capabilities. Ambiguous inferred delegation is read-only; shell execution must be explicit.

`ask` stops the entire tool-call batch and sends a structured worker-to-coordinator permission request. Only an acknowledged message from the coordinator, bound to the exact request ID, tool and arguments, can grant the operation before resume.

### Workspace isolation and integration

Git writers receive distinct worktrees. A dirty checkout or unavailable worktree triggers an observable, same-host, cross-session/process serialized lease; shell is denied in this fallback. The coordinator integrates through a project lease held across dirty checking, `git apply --check` and patch application. Protected secret/control paths and overlap conflicts fail explicitly. Unintegrated or changed worktrees are preserved.

### Persistence and observability

Stable host session IDs map to hashed snapshot and JSONL filenames. Snapshots atomically persist complete task, mailbox and workspace state with mode `0600`, validation and credential redaction. Restored `running` work becomes `failed/INTERRUPTED` and can resume only after a trusted runner is attached.

Versioned events cover lifecycle, attempts, messages, tools, authorization, retries, blocking, timeout, cancellation, integration, errors and metrics. `/tasks` and `/task` expose the state without relying on the deprecated callback UI path.

## Implemented functionality

- Per-session task registry, typed records and observable `TaskHandle` API.
- Validated state machine, single completion, safe cancellation, timeout and bounded retry/backoff.
- Foreground/background and fresh/fork delegation with selective, untrusted context summaries.
- Task DAG with cycle detection, dependency scheduling, failure/cancellation policies and backpressure.
- Structured mailbox with message IDs, correlation IDs, deduplication and acknowledgement.
- Runtime permission profiles, capability intersection, blocked permission flow and authorization events.
- Context-aware file, Git, shell, search and network tools with canonical path checks and abort propagation.
- Git worktree writers, serialized safe fallback, patch integration, conflict reporting and conservative cleanup.
- Strict structured result and verification terminal protocols with raw diagnostic preservation.
- JSONL event traces, secret redaction, snapshots, restart normalization and workspace recovery.
- Independent MoA candidates, duplicate hashes, partial failure preservation and separate synthesis.
- Nine-angle review workflow, normalized findings, independent verification, tri-state classification and gap sweep.
- Validated `.deepseek/agents/*.json` definitions and a safe writer example.
- `/tasks` plus `/task <id> status|cancel|resume|result|message|integrate|cleanup`.
- Executable coordinator/researcher/writer/tester/verifier example and deterministic end-to-end coverage.

## Files changed

### New runtime and public surface

- `src/orchestration/`: `types.ts`, `lifecycle.ts`, `schema.ts`, `result.ts`, `mailbox.ts`, `events.ts`, `fileLease.ts`, `runtimeSlot.ts`, `TaskRegistry.ts`, `workspace.ts`, `snapshot.ts`, `review.ts`, `OrchestratorSession.ts`, `index.ts`.
- `src/commands/tasks/index.ts` and `src/commands/task/index.ts`.
- `src/tools/shared/pathSafety.ts` was substantially hardened.

### Agent/runtime integration

- `src/agent/`: `agent.ts`, `auditLog.ts`, `config.ts`, `fileCheckpoint.ts`, `files.ts`, `mcp.ts`, `memory.ts`, `steering.ts`, `worktree.ts`, `providers/bedrock.ts`.
- `src/entrypoints/pipe.ts`, `src/settings/types.ts`, `src/permissions/risk.ts`, `src/utils/fs.ts`.
- `src/commands/help/index.ts`, `src/commands/index.ts`, `src/commands/types.ts`.
- `src/ui/App.tsx` and `src/ui/subagent/{SubagentLine.tsx,types.ts,useSubagents.ts}`.

### Delegation, MoA and tools

- `src/tools/SubAgent/`: `SubAgent.ts`, `contracts.ts`, `executor.ts`, `fixedAgents.ts`, `permissions.ts`, `verification.ts`.
- Removed `src/tools/SubAgent/concurrency.ts` and `src/tools/SubAgent/memory.ts` after migrating their behavior to session ownership.
- `src/tools/AskAgent/AskAgent.ts`.
- `src/tools/MoA/`: `MoA.ts`, `defaults.ts`, `executor.ts`, `index.ts`, `types.ts`.
- Context/security updates in `EditFile`, `Git`, `Glob`, `Grep`, `Memory`, `PatchFile`, `ReadFile`, `ReadFolder`, `Shell`, `UpdateKnowledge`, `WebFetch`, `WriteFile` and shared tool types.

### Tests, documentation and examples

- Added `tests/task-registry.test.ts`, `tests/subagent-executor.test.ts`, `tests/orchestration-workspace.test.ts`, `tests/orchestration-persistence.test.ts`, `tests/orchestration-memory.test.ts`, `tests/orchestration-review.test.ts`, `tests/orchestration-e2e.test.ts` and `tests/agent-files.test.ts`.
- Updated compatibility/security tests for agent authorization/config, AskAgent, Bedrock aborts, commands, fixed agents, risk policies, SubAgent contracts/permissions/verification, synchronous turns, MoA and interactive worktrees.
- Removed obsolete singleton-specific `tests/concurrency.test.ts` and `tests/subagent-memory.test.ts`; their invariants are covered by the new session/concurrency suites.
- Added `docs/mas-orchestrator.md`, `docs/mas-implementation-report.md`, `examples/mas-orchestrator.ts` and `examples/agents/safe-writer.json`.
- Added direct dependency `ajv` in `package.json` and updated `bun.lock`.

## Verification performed

| Gate | Result |
| --- | --- |
| Baseline `bun test` | 1265 pass, 3 skip, 1 pre-existing `grep` timeout failure |
| Focused orchestration, security, workspace, persistence, MoA and E2E tests | Passed during implementation |
| Final `bun test` | **1286 pass, 3 skip, 0 fail**, 2508 assertions across 90 files |
| `bun run typecheck` | Passed (`tsc --noEmit`) |
| `bun run build` | Passed |
| `bun examples/mas-orchestrator.ts` | Passed and produced non-empty output |
| `git diff --check` | Passed |
| New runtime file-size check | Passed; largest is `TaskRegistry.ts` at 498 lines |
| Lint/formatter | Not available: the repository defines no lint or formatter-check script |

The baseline `grep` timeout did not recur in the final suite. It was not hidden, skipped or modified as part of this work.

## Independent review and corrections

Read-only independent reviewers inspected the existing MAS, the clean-room reference principles and the implementation/security surface. Their highest-impact findings were reproduced and fixed before the final gates:

- A cancelled non-cooperative runner could release its concurrency permit too early. The permit now remains occupied until runner quiescence.
- A terminal dependent could be re-evaluated by a late dependency and throw asynchronously. Dependency evaluation now ignores terminal dependents.
- Writer serialization initially covered only a session. Atomic canonical-root leases now coordinate sessions and same-host processes.
- Snapshot restore, workspace ownership, permission grant/ack, shared-memory mutation, config inheritance, integration, path containment and secret redaction received additional adversarial tests and hardening.

The security review directly shaped fail-closed authorization, path/symlink containment, protected integration paths, sanitized shell execution, redirect validation and credential redaction.

CodeRabbit was executed once against the uncommitted worktree after implementation. All 35 reported findings were checked against the runtime and tests. Thirty-four were fixed completely; the cancellation-race finding was fixed at the immediate-abort boundary, while its suggestion to release the concurrency permit before an uncooperative runner settles was rejected because that would violate the scheduler's no-hidden-concurrency invariant. The retained behavior has an adversarial regression test.

## Compatibility and migration

Preserved behavior includes the CLI entrypoints, `Agent.run`, foreground SubAgent textual success, existing tool names and simple successful MoA text.

Intentional changes are:

- Background SubAgent and AskAgent return a structured handle instead of an untracked acknowledgement.
- Ambiguous inferred agents default to read-only; execution/write roles must be justified explicitly.
- Invalid declarative agents fail early instead of being skipped.
- Direct imports of the deleted concurrency/memory singletons must use the owning `OrchestratorSession`.
- Unsafe copied-worktree fallback and forced dirty cleanup are removed.
- Verification failure is no longer interpreted as approval, and synthesis failure no longer falls back to candidate one.

The migration details and lifecycle contracts are in `docs/mas-orchestrator.md`.

## Remaining risks and prioritized backlog

The delivered slice is local-process/same-host orchestration, not a distributed task service. Remaining work, in priority order, is:

1. Register stable runner factories so restart can automatically reattach executable task implementations rather than requiring a trusted host resolver.
2. Ingest provider-native cost consistently and perform pre-request budget admission when the provider reports reliable usage.
3. Represent the inline low-confidence SubAgent verification as a separate observable task; it is already fail-closed but currently shares the worker attempt.
4. Support arbitrary per-agent value schemas without also requiring the stable default SubAgent result contract.
5. Move large raw outputs/artifacts out of session snapshots into bounded artifact storage.
6. Replace the text task tree with a richer live DAG/duration view.
7. Migrate legacy audit/checkpoint streams fully under per-Agent correlation and remove the deprecated callback adapters after a deprecation cycle.
8. Add multi-host locking only if the product becomes distributed; no database or broker is justified for the current runtime.

## Reference discipline

The implementation used the requested process: observe behavior, extract a general harness principle, write a local specification/test and implement an original solution that fits DeepSeek Code. `/home/marcelo/claude-code-source` and the supplied public documentation were read-only conceptual references. No external repository, proprietary prompt, reconstructed source or uncertain-license code was copied into this codebase.
