# State machines

_Re-extracted on 2026-08-01. Source of truth: `src/agent/goal.ts`, `src/orchestration/lifecycle.ts`, `TaskRegistry.ts`, and `src/ui/interactionMode.ts`._

## Orchestrated task lifecycle

`done`, `failed`, `cancelled`, and `timed_out` are terminal unless the registry explicitly queues a retry/resume transition. A retryable failure may make the transient `failed → queued` transition; it is not an implicit success.

```mermaid
stateDiagram-v2
  [*] --> queued: spawn accepted
  queued --> running: scheduler starts attempt
  queued --> blocked: dependencies unavailable / explicit block
  queued --> cancelled: cancel
  blocked --> queued: dependencies ready or resume
  blocked --> failed: dependency policy = fail
  blocked --> cancelled: dependency policy = cancel
  running --> done: valid result envelope + budget accepted
  running --> failed: non-blocking error
  running --> blocked: blocking error / explicit block
  running --> cancelled: cancel
  running --> timed_out: deadline elapsed
  failed --> queued: retry or resume
  cancelled --> queued: resume
  timed_out --> queued: retry or resume
```

| State | Meaning | Entered by | Confidence |
| --- | --- | --- | --- |
| `queued` | Eligible or waiting to be scheduled. | Successful admission, retry, resume, dependencies resolving. | 🟢 |
| `running` | One attempt owns an abort controller and deadline. | Scheduler. | 🟢 |
| `blocked` | Work cannot proceed yet; a reason is recorded. | Dependency wait/failure policy, explicit block, blocking runner error. | 🟢 |
| `done` | A validated success envelope passed budget enforcement. | Runner completion. | 🟢 |
| `failed` | A non-success error was retained after retry policy. | Runner/dependency failure. | 🟢 |
| `cancelled` | Operator/system cancellation won. | Cancel path or dependency policy. | 🟢 |
| `timed_out` | The attempt exceeded its task timeout. | Deadline race. | 🟢 |

## Goal lifecycle

`paused`, `budget_limited`, and `usage_limited` are valid persisted status values. The examined goal module provides direct creation, completion, blocked escalation, and resume mechanics; the exact UI/agent event that assigns every limit status is outside this module. 🟡

```mermaid
stateDiagram-v2
  [*] --> active: createGoal
  active --> active: same/different blocker, count < 3
  active --> blocked: same blocker on third consecutive occurrence
  active --> complete: markGoalComplete
  active --> paused: persisted/update state
  active --> budget_limited: budget enforcement
  active --> usage_limited: provider/usage enforcement
  paused --> active: resumeGoal
  blocked --> active: resumeGoal resets blocker count
  budget_limited --> active: resumeGoal
  usage_limited --> active: resumeGoal
  complete --> complete: resumeGoal is a no-op
```

## Interaction mode lifecycle

The UI cycles modes in the fixed order shown below. The model may choose `plan` or `build`, but cannot choose `auto`; a user action is required for that elevation.

```mermaid
stateDiagram-v2
  [*] --> build
  build --> auto: user cycles mode
  auto --> plan: user cycles mode
  plan --> build: user cycles mode / plan accepted or aborted
  build --> review: review command
  review --> build: review finishes
```

## Agent turn lifecycle

```mermaid
stateDiagram-v2
  [*] --> initializing
  initializing --> ready: settings, steering, extensions, hooks loaded
  ready --> preparing_turn: user input accepted
  preparing_turn --> model_stream: context/refinement prepared
  model_stream --> authorizing_tool: model requests tool
  authorizing_tool --> tool_execution: mode, path, risk, policy and hooks allow
  authorizing_tool --> model_stream: denied or validation error becomes tool result
  tool_execution --> model_stream: result returned to model
  model_stream --> complete: assistant final response
  preparing_turn --> aborted: cancellation
  model_stream --> aborted: cancellation / iteration limit / fatal error
  complete --> ready
  aborted --> ready
```

## Invariants

- The task registry rejects illegal state transitions rather than repairing them silently. 🟢
- A blocked goal requires repeated identical evidence, not merely one hard turn. 🟢
- Mode permission is checked before a tool executes, but it is only one layer in the authorization pipeline. 🟢
