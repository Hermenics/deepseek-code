# DeepSeek Code — Project Report

> **Release snapshot:** `v0.6.10` (`3ac6796`)
> **Report date:** 2026-08-14
> **Package:** `@hermenics/deepseek-code`  
> **License:** Apache-2.0  
> **Confidence:** 🟢 confirmed in source · 🟡 architectural assessment · 🔵 recommendation

## Executive summary

DeepSeek Code is a local-first AI coding assistant for the terminal. It combines a React terminal interface, a provider-neutral agent loop, a controlled tool boundary, persistent sessions and goals, bounded multi-agent orchestration, and JavaScript Dynamic Workflows in one Bun application.

The product is no longer just a conversational wrapper around a model API. Release `0.6.10` is an agent execution platform with four distinct coordination levels:

1. A primary agent handles the interactive model/tool loop.
2. Subagents execute typed, role-constrained tasks, optionally in isolated Git worktrees.
3. The orchestrator coordinates bounded task graphs, messaging, recovery, review, and integration.
4. Dynamic Workflows let an approved JavaScript program compose agents, parallel work, pipelines, phases, budgets, and saved child workflows.

The system deliberately remains a local CLI rather than a hosted control plane. There is no application server, relational database, queue service, browser relay, or mandatory cloud backend. The operator owns the checkout and local operational state; external traffic is limited to the selected model provider, explicit web requests, and opt-in integrations.

The strongest engineering characteristics are the layered authorization model, provider abstraction, worktree-first writer isolation, persistent bounded orchestration, first-class recovery semantics, and an unusually capable in-tree terminal renderer. The primary maintainability risk is concentration of responsibility in a few very large integration files, especially `src/agent/agent.ts`, `src/ui/App.tsx`, `src/ink/ink.tsx`, and the TypeScript Yoga implementation.

## Report navigation

This document is the architectural index and executive assessment. Detailed reference material lives in four companion chapters:

- [Architecture and runtime](project-report/architecture-and-runtime.md) — C4 views, module boundaries, core execution flows, providers, TUI, packaging, and the experimental kernel.
- [Capabilities and operation](project-report/capabilities-and-operation.md) — tools, commands, modes, agents, orchestration, Dynamic Workflows, configuration, extensions, and user journeys.
- [Security, trust, and persistence](project-report/security-trust-and-persistence.md) — authorization, sandboxing, path safety, worktrees, data locations, recovery, and threat boundaries.
- [Quality, risks, and roadmap](project-report/quality-risks-and-roadmap.md) — test architecture, CI/release gates, maintainability findings, maturity assessment, and prioritized recommendations.

The comparative analysis is included in this document under [What makes it different](#what-makes-it-different-from-other-famous-clis). It deliberately treats Claude Code and Codex CLI as capable peer products; it does not use feature absence as a comparison shortcut.

Existing specialized documents remain useful:

- [Multi-agent implementation report](mas-implementation-report.md)
- [Multi-agent orchestrator guide](mas-orchestrator.md)
- [Settings reference](settings.md)
- [Mission Control architecture](mission-control/ARCHITECTURE.md)
- [Mission Control implementation status](mission-control/IMPLEMENTATION_STATUS.md)

## Product identity

| Dimension | Current position |
| --- | --- |
| Product | AI-powered coding assistant that lives in the terminal |
| Primary interface | Interactive TUI built with React and an in-tree Ink-compatible renderer |
| Secondary interface | Explicit `--pipe` mode, with optional JSON output |
| Runtime | Bun `>=1.1`, TypeScript, ESM |
| Distribution | npm package with a bundled `dist/cli.mjs` and executable `deepseek` wrapper |
| Model providers | DeepSeek, AWS Bedrock, Google Vertex AI, and local OpenAI-compatible endpoints |
| Workspace model | Local repository with guarded tools and Git-aware mutation |
| Coordination | Subagents, typed task DAGs, Mixture of Agents, review pipelines, and Dynamic Workflows |
| Persistence | Private local JSON/JSONL files plus Git worktrees; no database server |
| Extension model | Agents, skills, plugins, MCP servers, LSP servers, hooks, and saved workflows |
| Safety model | Interaction mode + schema + path + risk + policy + hook + approval checks |

## What makes it different from other famous CLIs

This is a **positioning comparison**, not a benchmark. Claude Code, Codex CLI, and DeepSeek Code all implement the same broad category: a terminal agent that can inspect a repository, call tools, change files, and run commands. The meaningful differences are their model ecosystems, host architecture, extension conventions, safety primitives, and degree of local configurability. Feature overlap is expected.

The Claude Code comparison was checked against the official documentation at [Extend Claude Code](https://code.claude.com/docs/en/features-overview), [parallel agents](https://code.claude.com/docs/en/agents), [agent teams](https://code.claude.com/docs/en/agent-teams), [permissions](https://code.claude.com/docs/en/permissions), [hooks](https://code.claude.com/docs/en/hooks), and [configuration](https://code.claude.com/docs/en/configuration). The Codex comparison was checked against the official [Codex CLI repository](https://github.com/openai/codex), [security guidance](https://developers.openai.com/codex/security), [rules](https://developers.openai.com/codex/exec-policy), [skills](https://developers.openai.com/codex/skills), [AGENTS.md guidance](https://developers.openai.com/codex/guides/agents-md), and [non-interactive mode](https://developers.openai.com/codex/noninteractive). These products change quickly; the links are the authoritative source for current behavior.

| Dimension | DeepSeek Code | Claude Code | Codex CLI |
| --- | --- | --- | --- |
| **Product center** | A local-first, provider-configurable coding CLI. The source has explicit adapters for DeepSeek, Bedrock, Vertex, and local OpenAI-compatible endpoints. | A Claude-centered coding agent with a mature extension and policy ecosystem. Its official docs describe built-in tools, subagents, agent teams, dynamic workflows, MCP, skills, hooks, and plugins. | An OpenAI coding agent that runs locally, with CLI, app, IDE, SDK, and cloud-adjacent surfaces in the broader product. The open-source CLI supports ChatGPT or API-key authentication. |
| **Agent orchestration** | `OrchestratorSession` owns a bounded task registry, DAG dependencies, mailbox, retries, cancellation, snapshots, typed result envelopes, role profiles, and writer workspaces. Dynamic Workflows reuse this spine. | Claude Code is not single-agent-only: it has isolated subagents, background agent views, experimental agent teams with a shared task list/mailbox, and dynamic workflows. The difference is not feature existence; DeepSeek's distinguishing choice is a local typed runtime with explicit task limits and integration contracts. | OpenAI's current Codex documentation also covers multi-agent workflows and broader automation surfaces. This report makes no claim that Codex lacks multi-agent support; DeepSeek's narrower distinction is the implementation of its local task registry and worktree integration inside this TypeScript runtime. |
| **Model/provider strategy** | Provider choice is a first-class runtime setting, including local Ollama/LM Studio-style endpoints. This is useful when deployment, cost, or model portability matters more than one vendor's integrated experience. | The product and documentation are organized around Claude models and Anthropic's surrounding platform, while deployment options and integrations are handled by Claude Code's own configuration model. | The product is organized around OpenAI/Codex models and OpenAI authentication, with the CLI itself remaining local. |
| **Safety boundary** | Layered host-side checks: interaction mode, closed schemas, canonical/symlink-aware paths, sensitive-path blocks, risk rules, allow/deny policy, hooks, approvals, fail-closed delegation, and Git worktrees. Worker shells use a Linux `bwrap` sandbox when a task context is present; this is not a universal OS sandbox for every interactive path. | Fine-grained permission rules, permission modes, hooks, managed settings, MCP controls, and additional-directory rules are documented as first-class controls. Claude also has deny/ask precedence and hook interception. | Sandbox and approval modes are central to the CLI, with explicit workspace/network choices and executable policy rules. `codex exec` defaults to read-only sandboxing and supports JSONL and structured output for automation. |
| **Project instructions** | Loads root `AGENTS.md` for cross-tool compatibility, DeepSeek-specific `DEEPSEEK.md`, and `.deepseek/steering/*.md`. In this snapshot, `AGENTS.md` loading is root-level rather than the full hierarchical discovery described by Codex. | Uses `CLAUDE.md`, rules, settings, skills, subagents, workflows, and `.mcp.json` across documented project/user scopes. | Uses hierarchical `AGENTS.md`/`AGENTS.override.md` discovery, configurable fallback filenames, and a project instruction size limit. |
| **Automation surface** | Interactive TUI plus `--pipe`; pipe mode can emit a compact JSON result containing the final output and tool names. Slash commands expose configuration, sessions, tasks, workflows, worktrees, goals, and diagnostics. | Interactive CLI plus non-interactive flags, settings, hooks, plugins, subagents, teams, and workflows. | Interactive CLI plus `codex exec`, JSONL event output, `--output-schema`, resumable sessions, and explicit automation-oriented sandbox controls. |
| **Terminal implementation** | Bun + TypeScript + React 19 with an in-tree Ink-compatible renderer and TypeScript Yoga/layout code. This gives DeepSeek Code direct control over Unicode width, focus, scrolling, resize, alternate-screen behavior, and frame rendering. | Its terminal UX is a mature reference point for this project, but this report does not infer internal implementation details from public behavior. | The official repository is a substantially different, Rust-heavy implementation with its own terminal, sandbox, policy, and app-server architecture. |
| **Extension model** | Skills, plugins, MCP, LSP, hooks, declarative agents, saved Dynamic Workflows, and local settings. Extensions are deliberately opt-in at several trust boundaries. | Skills, subagents, agent teams, hooks, MCP, plugins/marketplaces, rules, workflows, and managed enterprise policy are all documented first-class concepts. | Skills, MCP, AGENTS.md, configuration, rules, hooks, and SDK/app-server integrations are documented extension points. |

### The honest differentiator

DeepSeek Code is different because it is trying to be a **portable local agent runtime**, not because it invented terminal agents, multi-agent systems, worktrees, hooks, MCP, skills, or workflows. Its strongest combination is the coexistence of four provider choices, a fully local TypeScript/Bun implementation, a custom terminal renderer, explicit task/workspace contracts, and a deliberately layered authorization pipeline.

That combination has a trade-off. A smaller project could ship a simpler CLI faster; DeepSeek Code instead owns more infrastructure: its renderer, provider quirks, orchestration state machine, workflow host, persistence, and security checks. That increases control and portability, but also increases maintenance cost and the number of edge cases that must be tested.

### Claims this report deliberately does not make

- It does not claim Claude Code lacks multi-agent systems. Its official docs explicitly describe subagents, agent teams, and dynamic workflows.
- It does not claim Codex CLI lacks sandboxing, approvals, skills, `AGENTS.md`, rules, hooks, MCP, non-interactive execution, or multi-agent capabilities.
- It does not claim DeepSeek Code is more capable than those products on coding tasks. No controlled benchmark, task-success dataset, latency study, or cost study is part of this repository audit.
- It does not treat a `node:vm` workflow runtime or a path guard as an absolute security boundary. The effective safety level depends on the host, provider, permissions, extensions, and operating-system facilities available at runtime.

## Release `0.6.10` in context

Release `0.6.0` established **Dynamic Workflows** as a production capability. The current `0.6.10` line builds on that foundation with a more complete terminal experience: fullscreen alternate-screen rendering, environment-aware fullscreen detection, transcript scrolling, scrollbar interaction, progressive subagent activity, live thinking display, and workflow monitoring.

The implementation is intentionally layered over the existing production orchestrator. It does not introduce a second task scheduler and does not activate the experimental workflow engine in `src/kernel/`. Every workflow run owns a dedicated `OrchestratorSession`, so concurrency, agent limits, task state, budgets, worktrees, events, and snapshots reuse the same operational model as direct subagent execution.

The release line also keeps the prompt-refinement boundary explicit: a request for a **Dynamic Workflow** retains that product-specific meaning instead of being generalized into an ambiguous “dynamic” program. Discoverability is partly linguistic because the model must know that **Dynamic Workflows** is the feature name, while `/workflow` and `/workflows` are its command surfaces.

## Repository snapshot

The following counts were measured from the `v0.6.10` checkout. Generated artifacts and dependencies are excluded unless stated otherwise.

| Surface | Files | Lines | Interpretation |
| --- | ---: | ---: | --- |
| `src/` | 395 total; 391 TS/TSX | 52,519 TS/TSX | Production CLI, renderer, orchestration, tools, and embedded public data |
| `tests/` | 128 | 19,985 | Bun test suite and fixtures |
| TypeScript/TSX source + tests | 519 | 72,504 | Production TypeScript/TSX plus root tests |
| Website source | separate tree | not included | React marketing/documentation site |
| Built-in tools | 24 | — | Model-callable capability registry |
| Slash commands | 40 | — | Interactive command modules, excluding aliases and saved-workflow shortcuts |
| Test declarations | ~2,162 | — | Approximate `test`/`it`/`describe` matches from static source scan |
| Production dependencies | 34 | — | Runtime packages in the root package |
| Development dependencies | 6 | — | TypeScript and type packages |

The apparent size of `src/public/`—15,669 lines—is largely static/public data rather than control-flow complexity. The highest-complexity implementation areas are `src/ink/`, `src/ui/`, `src/agent/`, `src/tools/`, `src/native-ts/`, and `src/orchestration/`.

## System context

```mermaid
flowchart LR
  Dev[Developer] -->|prompts, commands, approvals| DSC[DeepSeek Code]
  DSC -->|completion and tool-call protocol| Models[DeepSeek · Bedrock · Vertex · local model]
  DSC -->|guarded read/write/shell/Git| Project[Local project workspace]
  DSC -->|private JSON/JSONL| State[Local settings · sessions · memory · workflows]
  DSC -->|optional stdio/HTTP| MCP[Approved MCP servers]
  DSC -->|optional child process| LSP[Configured language servers]
  DSC -->|explicit install/update| Extensions[Skill and plugin sources]
  DSC -->|explicit fetch| Web[Public web resources]
```

DeepSeek Code is the local authority coordinator. The model proposes actions, but it does not directly own the filesystem, shell, Git, task scheduler, or workflow runtime. Those capabilities remain behind typed host adapters.

## Architectural shape

```mermaid
flowchart TB
  Entry[CLI and pipe entrypoints] --> UI[React TUI]
  Entry --> Agent[Agent core]
  UI --> Agent
  Agent --> Provider[Provider adapters]
  Agent --> Control[Authorization pipeline]
  Agent --> Tools[Tool registry]
  Agent --> Orch[OrchestratorSession]
  Agent --> WF[WorkflowManager]
  WF --> Runtime[Worker + node:vm]
  WF --> Orch
  Orch --> Tasks[TaskRegistry + mailbox + snapshots]
  Orch --> Git[Workspace manager + Git worktrees]
  Agent --> Context[Settings + steering + memory + sessions + goals]
  UI --> Ink[In-tree Ink renderer + TypeScript Yoga]
```

### Logical layers

| Layer | Main modules | Responsibility |
| --- | --- | --- |
| Bootstrap | `src/index.tsx`, `src/entrypoints/`, `src/bootstrap/` | Parse invocation, migrate/load state, choose interactive or pipe execution |
| Presentation | `src/ui/`, `src/ink/`, `src/native-ts/` | Conversation UI, input, dialogs, rendering, layout, terminal lifecycle |
| Agent control | `src/agent/`, `src/services/compact/` | Model loop, provider protocol, context, tools, compaction, goals, sessions |
| Capability boundary | `src/tools/`, `src/permissions/`, `src/hooks/` | Validate, authorize, execute, audit, and report local operations |
| Coordination | `src/orchestration/`, `src/workflows/` | Task DAGs, subagents, worktrees, recovery, executable workflows |
| Configuration | `src/settings/`, `src/constants/`, `src/types/` | Layered settings, defaults, contracts, provider and UI types |
| Extensibility | `src/plugins/`, `src/skills/`, MCP and LSP adapters | Discover and run explicitly enabled extension points |
| Experimental | `src/kernel/` | Dormant SQLite/event-bus/thread/workflow research path, not wired to production |

## Core execution model

### Interactive turn

```mermaid
sequenceDiagram
  actor User
  participant TUI
  participant Agent
  participant Model
  participant Guard as Authorization
  participant Tool
  User->>TUI: Prompt or slash command
  TUI->>Agent: run(message, callbacks)
  Agent->>Agent: Load context and compact if needed
  Agent->>Model: Messages, system context, tool schemas
  Model-->>Agent: Streamed text/reasoning or tool call
  Agent->>Guard: Validate mode, args, paths, risk, policy, hooks
  Guard-->>User: Ask approval when required
  Guard->>Tool: Execute allowed call
  Tool-->>Agent: Typed result
  Agent->>Model: Tool result and continue loop
  Model-->>TUI: Final response and usage
  Agent->>Agent: Persist session and optional memory
```

The loop is bounded, cancellable, provider-aware, and responsible for transcript consistency. A tool rejection becomes an explicit tool result rather than a silent side effect. A user abort propagates to active foreground work.

### Delegated task

```mermaid
flowchart LR
  Request[SubAgent / AskAgent / workflow agent()] --> Profile[Resolve agent role and profile]
  Profile --> Admission[Validate graph, limits, budget, dependencies]
  Admission --> Workspace{Writer?}
  Workspace -->|no| Shared[Read-only shared workspace]
  Workspace -->|yes| Worktree[Owned Git worktree]
  Shared --> Runner[Subagent runner]
  Worktree --> Runner
  Runner --> Contract[Validate terminal result/schema]
  Contract --> Registry[Persist state, usage, artifacts, events]
  Registry --> Parent[Return result or failure envelope]
```

### Dynamic Workflow

```mermaid
sequenceDiagram
  actor User
  participant Gate as Agent authorization
  participant Approval as Approval store
  participant Host as WorkflowManager
  participant Worker
  participant VM as node:vm
  participant Orch as OrchestratorSession
  User->>Gate: Script, args, optional name
  Gate->>Approval: Verify/record exact script hash for project
  Gate->>Host: Start authorized source
  Host->>Host: Create run and private journal
  Host->>Worker: Start isolated runtime
  Worker->>VM: Evaluate approved source
  VM->>Host: RPC agent/parallel/pipeline/workflow/log/phase
  Host->>Orch: Admit constrained agent calls
  Orch-->>Host: Results, usage, failures, worktrees
  Host-->>VM: RPC response
  VM-->>Host: Final result or runtime error
  Host->>Host: Persist terminal status and replay data
```

## Capability map

| Capability | What the release provides |
| --- | --- |
| Coding agent | Streaming reasoning/text, native or adapted tool calls, retries, cancellation, compaction, cost/context tracking |
| Local tools | Read, search, edit, patch, shell, Git, web fetch, LSP, memory, plans, goals, and introspection |
| Multi-agent execution | Declarative agents, fixed coder/reviewer/tester roles, background tasks, task messaging, structured results |
| Review | Parallel perspectives, duplicate suppression, optional independent verification, and gap sweep |
| Mixture of Agents | Independent candidates plus mandatory aggregation with bounded concurrency and partial-failure handling |
| Persistent goals | Objective, status, budget, elapsed/token usage, bounded continuations, repeated-blocker semantics |
| Dynamic Workflows | Approved JavaScript coordination with agents, parallelism, pipelines, phases, budgets, child workflows, replay, and control commands |
| Sessions and memory | Project-isolated history, resume, checkpoints, retention, scoped persistent memory, legacy migration |
| Extensibility | Custom agents, skills, plugins, MCP, LSP, lifecycle hooks, saved workflows |
| Terminal experience | Responsive conversation, tool cards, diffs, approvals, Vim input, themes, task/workflow monitoring, alternate-screen option |

## Dynamic Workflows at a glance

Dynamic Workflows are JavaScript coordination programs, not generated TypeScript applications or a separate agent framework. A workflow can use top-level `await` and `return` and receives only the host capabilities deliberately injected into its runtime:

```js
export const meta = {"name":"review-and-fix","description":"Review, fix, and verify a change"};

phase("review");
const findings = await parallel([
  () => agent("Review correctness and edge cases"),
  () => agent("Review security and permissions")
]);

phase("implementation");
const fix = await agent(`Resolve these findings: ${JSON.stringify(findings)}`, {
  agentType: "coder",
  isolation: "worktree",
  phase: "implementation"
});

phase("verification");
return await agent(`Verify this implementation result: ${JSON.stringify(fix)}`, {
  agentType: "reviewer",
  phase: "verification"
});
```

Key limits are constants rather than speculative configuration: at most 17 agent calls per workflow, concurrency capped at 16, `parallel`/`pipeline` inputs capped at 4,096, one child-workflow layer, 256 KiB source, a 120-second default host timeout, and a 1-second synchronous VM execution cap.

Saved workflows are discovered from the nearest project `.deepseek/workflows/` directory and then `~/.deepseek/workflows/`. Built-in slash commands win name collisions; a colliding workflow remains callable through `/workflow run <name>`.

## Authority and safety model

DeepSeek Code uses cumulative checks rather than treating one prompt or sandbox as a complete security boundary:

```mermaid
flowchart LR
  Call[Proposed capability call] --> Mode[Interaction mode]
  Mode --> Schema[Input schema]
  Schema --> Path[Canonical path boundary]
  Path --> Risk[Risk classification]
  Risk --> Policy[Allow / deny / suppress rules]
  Policy --> Agent[Agent profile and tool allowlist]
  Agent --> Hook[Pre-tool hooks]
  Hook --> Approval[Human approval when required]
  Approval --> Execute[Bounded execution]
  Execute --> Post[Post-hook, audit, diff/verification]
```

Important invariants include deny-over-allow precedence, canonical path containment with symlink checks, secrets separated from normal settings, user-scoped executable configuration, fail-closed non-interactive behavior, worktree isolation for writers, redaction before persisted operational events, and exact-content workflow approval.

The Dynamic Workflow VM is explicitly defense in depth, not an absolute security sandbox. Consent, constrained host RPC, tool permissions, process termination, timeouts, and worktree isolation remain the real safety boundary.

## Persistence model

The system stores operational records locally and avoids a database dependency.

| Record | Typical location | Purpose |
| --- | --- | --- |
| Credentials | `~/.deepseek/config.json` | Provider secrets and legacy-compatible setup values |
| User settings | `~/.deepseek/settings.json` | User authority and preferences |
| Project settings | `<project>/.deepseek/settings.json` | Shareable project preferences |
| Local settings | `<project>/.deepseek/settings.local.json` | Machine-local overrides |
| Sessions | `~/.deepseek/sessions/<project>/` | Conversation and resumable UI/agent state |
| Memory | `~/.deepseek/memory/` or `.deepseek/memory/` | Bounded user/project knowledge |
| Orchestration state | Session snapshot/event locations | Tasks, results, mail, usage, recovery data |
| Dynamic Workflow runs | `~/.deepseek/projects/<project>/<session>/workflows/<run-id>/` | Script, run state, arguments, journal, replay data |
| Workflow approvals | `~/.deepseek/workflow-approvals.json` | Project-bound SHA-256 approvals |
| Agent definitions | `~/.deepseek/agents/`, project/local agent directories | Declarative custom agent registry |
| Worktrees | Project-managed `.deepseek/worktrees/` area | Isolated writer workspaces |
| Logs | `~/.deepseek/logs/` | Audit and development diagnostics |

Sensitive or resumable files use restrictive permissions where the host supports POSIX modes. State updates use atomic rename patterns and validation on restore. The detailed map and recovery semantics are in [Security, trust, and persistence](project-report/security-trust-and-persistence.md).

## Quality posture

The release pipeline checks the core application and the marketing website independently. The root CI installs with Bun using a frozen lockfile, runs TypeScript validation, executes coverage tests, builds the package, and smoke-tests the packed npm artifact. The website job installs with npm and runs lint, tests, and a production build.

The latest validation performed for this report recorded:

| Gate | Result |
| --- | --- |
| `bun run typecheck` | Passed |
| `bun test tests` | **1,669 passed, 3 skipped, 0 failed** across 127 files and 3,606 assertions |
| `bun run build` | Passed |
| Restricted-sandbox test run | 1,663 passed, 3 skipped, 6 environment-dependent failures; worker `bwrap` could not create its network namespace |

The passing suite was run with the host sandbox available and an isolated `HOME`. The restricted-sandbox result is retained because it identifies a real operational dependency: worker shell tests require Linux `bwrap` and the ability to create the namespaces requested by the implementation. This is an environment limitation, not evidence of a source-level regression in the host-validated run. `bun run pack:check` was not re-run for this report.

### Practical quality verdict

For a pre-1.0 project, DeepSeek Code is **technically strong and unusually ambitious**, especially in its local orchestration, workspace isolation, provider adapters, terminal renderer, and contract tests. It is good enough to be a serious power-user tool and a credible foundation for continued development. The repository evidence does not justify calling it a universally superior coding agent: model quality is provider-dependent and unbenchmarked, the project requires Bun, worker-shell isolation depends on host facilities such as `bwrap`, and several central modules remain expensive to maintain. The fairest summary is **strong engineering foundation, broad capability, incomplete product maturity**.

## Architectural assessment

| Dimension | Assessment | Rationale |
| --- | --- | --- |
| Product coherence | **8.5/10** 🟡 | Local-first coding, provider choice, agent delegation, worktrees, goals, and workflows reinforce one product thesis |
| Runtime architecture | **8/10** 🟡 | Clear control boundaries and reuse of orchestration; a few integration modules are oversized |
| Safety model | **8.5/10** 🟡 | Strong layered defenses and explicit authority; executable extensions and host dependencies still require disciplined review |
| Test discipline | **8.5/10** 🟡 | Broad contract/regression coverage with a clean host-validated run; coverage percentage and cross-platform sandbox behavior still need ongoing gates |
| Operability | **8/10** 🟡 | Cancellation, persistence, recovery, diagnostics, and monitoring are first class; no remote fleet control by design |
| Extensibility | **8.5/10** 🟡 | Multiple deliberate extension surfaces with validation and opt-in rules; path conventions are not fully unified |
| Maintainability | **6.5/10** 🟡 | Good module map, but several 1,700–2,500-line central files exceed the stated 500-line project rule |
| Documentation | **7.5/10** 🟡 | Strong specialized and reverse-engineered docs; older generated snapshots and companion chapters still lag the current release |

**Overall engineering maturity: 8.1/10.** This is a strong pre-1.0 CLI with unusually broad safety, orchestration, and test foundations. That rating is about the engineering system, not model intelligence or guaranteed task success. Its next maturity step is not more capability breadth; it is reducing integration hotspots, aligning documentation with release behavior, making `bwrap`/platform requirements explicit, and consolidating transitional paths.

## Principal strengths

1. **One production orchestration spine.** Direct subagents and Dynamic Workflows converge on `OrchestratorSession`, preventing two competing schedulers.
2. **Authority is explicit and layered.** Model intent never automatically equals host permission.
3. **Writer isolation is a design invariant.** Git worktrees are part of the task model rather than an optional convention.
4. **Failure and recovery are modeled.** Tasks, goals, sessions, and workflows have explicit terminal/interrupted states and resumable data.
5. **Provider differences are acknowledged.** The adapters do not pretend Bedrock, Vertex, DeepSeek, and local endpoints expose identical protocols.
6. **The terminal renderer is product infrastructure.** DeepSeek Code controls layout, Unicode width, focus, resize, scrolling, and frame diffing instead of relying on opaque behavior.
7. **Dynamic Workflows are bounded.** Source size, synchronous execution, total calls, concurrency, pipeline width, child depth, budgets, consent, and replay all have explicit rules.

## Principal risks

1. **Oversized integration modules.** `agent.ts` (1,922 lines), `App.tsx` (2,099), `ink.tsx` (1,763), `native-ts/yoga-layout/index.ts` (2,578), and `ink/components/App.tsx` (704) exceed the project's 500-line rule. This raises review surface and regression coupling.
2. **Two orchestration narratives.** Production uses `src/orchestration/` and `src/workflows/`, while `src/kernel/` contains an unreferenced experimental SQLite/event-bus/workflow stack. Without a clear decision, contributors can mistake research code for the supported path.
3. **Path convention drift.** Most modern state lives under `.deepseek`, but plugin and legacy checkpoint paths still include `.deepseek-code`. Compatibility is useful, but the intended destination should remain explicit.
4. **Documentation drift.** The prior Reversa extraction describes `v0.4.15`, counts 23 tools and 38 commands, and predates Dynamic Workflows. The root report and specialized chapters now have a current `v0.6.10` index, but older generated snapshots and companion chapters still need synchronized refreshes.
5. **Capability-matrix drift.** The built-in registry and introspection advertise `edit_file`, `moa`, and goal tools, but the current Build-mode allowlist omits them. Auto permits them because it bypasses the static set. Tests assert the existing partial matrix instead of registry completeness.
6. **Owned renderer cost.** The custom Ink/Yoga stack is a differentiator and a permanent correctness burden across terminals, Unicode, input methods, and React reconciler changes.
7. **Workflow trust semantics.** `node:vm` reduces accidental capability exposure but cannot be marketed as a hard isolation boundary; approval wording and host RPC constraints must stay precise.

## Recommended priorities

The roadmap is intentionally conservative: preserve working behavior and reduce the cost of future releases.

### P0 — release truth and guardrails

- 🔵 Make README capability/default tables derive from, or be checked against, command/tool/settings registries.
- 🔵 Reconcile the interaction-mode allowlist with the tool registry: explicitly decide Build access for `edit_file`, `moa`, and goal tools, then add a completeness test so advertised tools cannot become unreachable accidentally.
- 🔵 Add a small documentation snapshot check for version, tool count, command count, and workflow limits.
- 🔵 Mark `src/kernel/` unmistakably experimental in its README/module entrypoint, or remove it when no longer part of a concrete roadmap.

### P1 — integration hotspot reduction

- 🔵 Extract cohesive controllers from `Agent` and `ui/App` only where behavior already forms a stable boundary: workflow UI wiring, permission requests, session lifecycle, and streaming state are the strongest candidates.
- 🔵 Split the in-tree renderer by terminal lifecycle, render scheduling, and input dispatch without changing its public API.
- 🔵 Break the Yoga implementation into algorithmic units backed by the existing renderer tests.

### P2 — operational polish

- 🔵 Add a dedicated workflow selector/monitor footer when the minor release scope calls for it; keep the current inline monitor as the baseline.
- 🔵 Decide the long-term `.deepseek` migration policy for plugins and legacy checkpoints.
- 🔵 Add CI assertions for minimum coverage only after a stable baseline is agreed; raw test count alone should not become a vanity gate.
- 🔵 Continue provider-specific contract fixtures as new DeepSeek, Bedrock, and Vertex model families are introduced.

## Final judgment

DeepSeek Code `0.6.10` has a strong architectural identity: **a local agent operating system for software work, expressed through a terminal**. The codebase has gone beyond a single-agent CLI while retaining explicit limits, local ownership, and observable execution.

Dynamic Workflows fits the system because it is a coordination language over existing agents and task infrastructure, not a parallel framework. That decision is the release's most important architectural success.

The project should now favor consolidation over feature accumulation. The shortest path to a stronger `0.7.x` line is to make the current architecture easier to understand and change: shrink the central coordinators, reconcile documentation with source, clarify the experimental kernel, and keep the authorization/recovery contracts non-negotiable.

---

### Evidence notes

This report combines direct inspection of the `v0.6.10` source, repository metrics, CI/build configuration, host-validated tests, official Claude Code/Codex documentation, and the project's existing reverse-engineered architecture artifacts. The local `~/claude-code` reference mentioned in project guidance was not present, so no local Claude source comparison was claimed. Statements labeled 🟡 are assessments or inferences rather than runtime guarantees. Recommendations are labeled 🔵 and are not claims about already implemented behavior.
