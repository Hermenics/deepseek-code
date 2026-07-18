# MAS Orchestrator

Status: accepted and implemented as an incremental clean-room extension of the existing DeepSeek Code runtime.

## Decision

Every `Agent` owns one `OrchestratorSession`. A session owns its task registry, scheduler, DAG, mailbox, event sink, workspace manager, persistent-memory instance and optional snapshot store. Normal runtime execution no longer depends on the former SubAgent concurrency or turn-memory singletons. Compatibility setters remain only for callers that invoke `SubAgent` or `AskAgent` without a `ToolExecutionContext`.

This design follows observed harness principles rather than external implementation details: explicit identity, bounded concurrency, isolated mutable work, structured terminal protocols, fail-closed verification and auditable state changes. No proprietary prompt or reconstructed source was copied.

## Invariants

The runtime enforces these invariants:

- A task belongs to exactly one session and has a stable `taskId`.
- A terminal attempt settles once. A late or second completion is rejected.
- `done` is immutable. Retry or resume is possible only from the documented recoverable states and within the attempt limit.
- Cancellation is idempotent. Timeout and cancellation produce distinct terminal states and error codes.
- Dependencies are validated before mutation. Cyclic DAGs are rejected.
- Scheduler limits apply per session; a cancelled or timed-out runner retains its permit until its promise actually settles, so a non-cooperative runner cannot create hidden concurrency.
- A worker cannot widen its permission profile through prompts, tool arguments, project allow rules or declarative `coordinator-integrator` elevation. Nested workers inherit the intersection of parent capabilities, profile and task allowlist.
- A researcher shares the project only through read tools. A writer receives a Git worktree; when Git worktrees are unavailable or the parent is dirty, writers take a same-host filesystem lease keyed by canonical project root. The lease coordinates sessions and processes.
- Tester shell execution mounts the project read-only. Writer shell execution is writable only inside a Git worktree; shell is denied in serialized fallback, where only path-validated file tools may write.
- Invalid structured output and internal verifier failure never produce success.
- Candidate output is untrusted data. MoA synthesis receives labeled JSON in a user-data message, separate from the synthesizer instruction.
- Cleanup is scoped to a registered worktree. Dirty, changed-after-integration or ignored work is preserved.
- Task events and snapshots redact credential-shaped values before persistence.

## Components

`TaskRegistry` owns records and scheduling. `TaskHandle` exposes `status`, `awaitResult`, `cancel`, `sendMessage`, `resume` and `getResult`. `TaskMailbox` deduplicates by message ID and tracks acknowledgement. `TaskEventSink` emits versioned events in memory and, optionally, JSONL. `TaskWorkspaceManager` creates and integrates per-task worktrees. `TaskSnapshotStore` atomically persists a session. `OrchestratorSession` composes the components and provides the execution context passed to tools.

The public entry point is `src/orchestration/index.ts`.

## Lifecycle

Allowed transitions are:

```text
queued   -> running | blocked | cancelled
blocked  -> queued | failed | cancelled
running  -> done | failed | blocked | cancelled | timed_out
failed   -> queued       (explicit resume or bounded retry)
cancelled -> queued      (explicit resume)
timed_out -> queued      (explicit resume)
done     -> <none>
```

Spawn validates total-task, depth and fan-out limits before insertion. Tasks with unfinished dependencies become `blocked`; when all dependencies complete they return to `queued`. Dependency failure uses the configured `block`, `fail` or `cancel` policy. Parent cancellation uses `cascade` or `detach`.

Each attempt receives its own `AbortController`, deadline and `TaskRunContext`. A timeout aborts the attempt with `TIMED_OUT`. Coordinator cancellation aborts it with `CANCELLED`. Partial output set through `setPartial` is retained in failure envelopes. Retriable errors use bounded exponential backoff; the task is cancelable while waiting. Abort settles the public envelope immediately but the scheduler releases capacity only after the runner is quiescent.

## Task DAG

Dependencies are task IDs in the same session. Insertion requires every dependency to exist. `addDependency` rejects self-dependencies, cycles and changes to running or terminal tasks. The ready queue is FIFO and constrained by the session concurrency limit. A task can be inspected as ready, blocked by unfinished dependencies, blocked by an impossible dependency, running or terminal.

The default limits are concurrency `5`, total tasks `17`, depth `2`, fan-out `5`, retry `1` and timeout `120000 ms`. Settings under `agents` and validated agent definitions can narrow these values. A task record exposes whether provider usage metrics were available; monetary cost is never estimated when a provider did not report it.

## Schemas

All envelopes are version `1`.

`TaskRecordV1` includes session/parent identity, type, foreground/background mode, fresh/fork context mode, state, graph edges, timestamps, attempt and timeout, delegation limits, permission profile, workspace, artifact references, result/error/block reason, provider metrics and metadata.

`TaskResultEnvelopeV1` includes `taskId`, `sessionId`, terminal status, typed value, partial value, artifacts, metrics, raw diagnostic output, optional typed error and completion timestamp. The runtime validates supplied envelopes before accepting completion.

`TaskMessageV1` includes message ID, sender, recipient, type, correlation ID, task ID, timestamp, structured payload and processing status. Supported types are progress, result, blocked, question, error, cancel, permission and resource.

Subagents terminate through the private `submit_result` tool. The default result schema requires summary, confidence, files read/changed, findings, suggestions and metadata. A terminal call must be the only terminal effect and pass Ajv validation. Missing, repeated, mixed or invalid terminal calls receive one correction attempt, then fail as `INVALID_RESULT`; raw content is preserved.

Verification terminates through `submit_verification` with `CONFIRMED`, `PLAUSIBLE` or `REFUTED`, a reason, issues and evidence. Only `CONFIRMED` approves. Empty output, exceptions, timeout and schema failure remain unverified or fail.

## Delegation and context

Foreground tasks block their caller. Background tasks immediately return a JSON handle containing schema version, session, task and state. `AskAgent` is the compatible background alias.

Fresh workers receive their specialization, working directory and self-contained task. Fork workers receive only selected structured summaries as labeled, untrusted JSON in the user message; prior results never become system instructions. Full chat history and repository contents are not copied into worker prompts. Nested delegation is denied by default, requires `allowDelegation: true` and is bounded by depth/fan-out limits.

## Permissions

Runtime profiles are `researcher-readonly`, `tester`, `writer-worktree` and `coordinator-integrator`. Profile checks run before declarative allow rules. Delegated configs cannot select `coordinator-integrator`. An `ask` decision stops the entire tool-call batch, blocks the task and emits a worker-to-coordinator permission message; it is never treated as allow. The coordinator can send `allow <tool>` or `deny <tool>` through `/task ... message`, then resume the same handle. Grants are structured, sender-checked, acknowledged and bound to the exact request ID, tool and arguments; they cannot be created or broadened by agent text.

High-risk commands require an authorization decision outside agent text. Native Git `push`, force-push and `pull` are high-risk even when invoked through the Git tool. File paths are canonicalized before permission, checkpoint or undo bookkeeping, then revalidated by the tool. Agent-config file globs are project-relative, do not follow symlinks, reject secrets and share a total context budget.

Worker shell commands run through Bubblewrap with cleared environment, private home/tmp, no network and namespace isolation. Testers receive a read-only project mount. Missing sandbox support returns an explicit tool error; there is no unsandboxed worker fallback.

## Workspaces and integration

Every writer tries `git worktree add --detach` under `.deepseek/worktrees/<session-task-random>`. Absolute parent paths are translated into the assigned worktree. A dirty parent is not cloned from stale `HEAD`; it uses the explicit serialized fallback so the worker sees current state. If a worktree cannot be created, a `workspace_fallback` event records the reason.

Integration holds a project-scoped lease across dirty-check, `git apply --check` and apply. It captures a binary patch and content hash, rejects overlap, secrets and runtime-control paths, then applies. Failure preserves the worktree and reports the conflict. Cleanup is allowed only after integration, only for the registered path, only when the current patch hash still matches and no ignored work remains.

The older interactive `/worktree` command now requires a real Git repository. Its filesystem-copy fallback and forced dirty cleanup were removed.

## Persistence and recovery

Pass `snapshotFile` to `OrchestratorSession` to atomically persist task, mailbox and workspace snapshots with mode `0600`. `Agent` automatically assigns a hashed snapshot path when the host supplies a stable session ID and restores it during initialization. Restore requires matching session/project identity and validates the complete task, message, result and workspace schemas before mutation:

```ts
const restored = await OrchestratorSession.restore({ projectRoot, snapshotFile })
restored.registry.attachRunner(taskId, recoveredRunner)
restored.registry.resume(taskId)
```

A task captured as `running` restores as `failed/INTERRUPTED`, retaining partial data. Registered worktree ownership and integration hashes are restored for later inspection, integration or safe cleanup. Arbitrary JavaScript runners are intentionally not serialized; the host must reattach a trusted runner before resuming.

## Observability and control

JSONL events cover task creation, state transitions, attempt start/end, messages, tools, authorization, retry, block, timeout, cancellation, completion, workspace creation/fallback, integration, session root changes and errors. Every event carries session and correlation IDs and, when applicable, task and parent IDs.

The TUI commands are:

```text
/tasks
/task <id> status
/task <id> cancel
/task <id> resume
/task <id> result
/task <id> message <text | allow tool | deny tool>
/task <id> integrate
/task <id> cleanup
```

`/tasks` renders the task tree and state. `/task status` returns the complete record including duration inputs, attempts, errors, usage, workspace and artifacts.

## MoA and independent review

MoA limits candidates to five, runs them independently with bounded concurrency and retries, preserves empty/failed candidates, labels every response and marks exact duplicates by SHA-256. Only unique successful candidates count toward `minResponses`. The synthesizer is a separate model call. Synthesizer failure throws `MoAExecutionError` with partial candidates; it never falls back to candidate one.

`runMultiAgentReview` schedules read-only reviewers for correctness, security, concurrency, error handling, regressions, tests, compatibility, performance and maintainability. It schema-validates findings, normalizes and deduplicates them, then runs a separate batch verification task. Findings become `CONFIRMED`, `PLAUSIBLE` or `REFUTED`. Verification failure leaves findings `PLAUSIBLE` with an explicit verification error. An optional final gap-sweep task runs after classification.

## Declarative agents

The canonical format is `.deepseek/agents/*.json`. Definitions are validated eagerly and again after inheritance with `AGENT_CONFIG_SCHEMA`. Supported fields include responsibility, usage, model, tools, permission profile and rules, isolation, timeout, retry, delegation limits, context mode, token/cost budgets and output schema. Invalid JSON, unknown fields, traversal globs, invalid schema, unsafe inheritance or a profile/isolation mismatch aborts registry loading with the source path.

Example: `examples/agents/safe-writer.json`.

## Migration

- `Agent.run`, foreground `subagent` text and successful `moa` text remain compatible.
- `ask_agent` and background `subagent` now return versioned handles rather than an untracked acknowledgement.
- Malformed agent files now fail early instead of being silently skipped.
- Unknown provider costs are omitted and marked unavailable instead of estimated.
- Interactive copied worktrees and forced dirty removal are no longer supported.
- Direct imports of the former `SubAgent/concurrency` and `SubAgent/memory` singletons must migrate to `OrchestratorSession.registry` and `OrchestratorSession` context summaries.
- Legacy SubAgent provider/model/callback setters remain deprecated adapters only; normal `Agent` instances do not call them.

## Remaining backlog

Prioritized follow-up work is: provider-native monetary-cost ingestion and pre-request budget admission; runner factories registered by stable name so restart can reattach automatically; a TUI DAG view with live duration columns rather than text-only inspection; provider-specific structured-output APIs where available; a separate observable task record for the inline low-confidence SubAgent verifier; arbitrary per-agent value schemas beyond the stable default SubAgent contract; artifact storage outside snapshots for large raw outputs; per-Agent migration of the legacy audit/checkpoint stream; and multi-host writer coordination if DeepSeek Code ever becomes distributed. A broker or database is intentionally out of scope until that requirement exists.
