# DeepSeek Code — Code Analysis

> Re-extracted from `v0.4.15` on 2026-08-01. Confidence: 🟢 **CONFIRMED** unless stated otherwise.

## Runtime model

DeepSeek Code is a Bun CLI with two execution surfaces. `src/entrypoints/cli.tsx` starts the React terminal UI; `src/entrypoints/pipe.ts` accepts stdin and produces plain text or a terminal JSON envelope. `src/index.tsx` delegates to the CLI and `build.ts` bundles it into `dist/cli.mjs` plus the `deepseek` shell wrapper.

The interactive bootstrap migrates legacy credentials, loads merged settings and saved provider data, resolves a requested or automatic session, optionally loads a custom agent, then renders either setup or `ui/App`. One-shot `doctor`, `version`, `help`, `update`, and `logout` paths exit before rendering. Pipe mode disables destructive shell confirmation because no human can answer it.

## Core agent loop

`Agent` owns the model client, message history, tool registry, session approvals, per-turn write tracking, context usage, compaction state, and an `OrchestratorSession`. Construction starts asynchronous initialization that loads steering (`AGENTS.md`, `DEEPSEEK.md`), merged settings, opt-in MCP tools, persistent memory, and session-start hooks.

For every user turn, `Agent.run()` waits for initialization, resets per-turn state, creates one `AbortController`, micro-compacts old read-only results, optionally fully compacts the conversation, optionally refines a sufficiently long prompt, appends pending asynchronous notes, and enters the model/tool loop.

The loop is bounded to 100 iterations and retries 429/503 failures with 1/2/4-second backoff. DeepSeek/local use streaming native tool calls. Vertex and non-mantle Bedrock use non-streaming calls. Bedrock R1 receives XML-like tool definitions in the system prompt and tool results as user messages; Bedrock V3 models use native OpenAI-compatible chat completions. Final responses are saved to history and may asynchronously extract at most one safe memory fact.

Tool calls are schema-validated before permission checks. The effective tool gate is: interaction mode, workspace path boundary, risk assessment, settings allow/deny rules, active-agent allowlist, pre-tool hooks, execution, post-tool hooks, optional diff review and verification. Mutating tools create file checkpoints for undo. A turn abort cascades to foreground orchestration tasks.

## Providers, context and persistence

`llmClient` builds the OpenAI client for DeepSeek and local endpoints, a SigV4 fetch adapter for Bedrock, and an OAuth-token adapter for Vertex. Bedrock model discovery filters AWS foundation models; Vertex caches OAuth tokens with a five-minute refresh buffer. Context limits are one million tokens for native DeepSeek models and 128k for Bedrock/Vertex/custom fallback. Cost estimation separates regular, cached, and output tokens.

Session records are project-isolated by a hash of the absolute current directory under `~/.deepseek/sessions/`. They preserve agent/UI messages, provider/model, modified files, language, active agent and goal; exports redact secrets. Memory is stored as bounded, delimiter-separated entries in user or project scope, rejects instruction-like entries, serializes mutation with a cross-process file lease, and writes private files with mode `0600`.

## Persistent goals and task orchestration

Goals are explicit state with a status, optional token budget, continuation cap, accumulated tokens/time, and repeated-blocker counter. A blocker only turns into `blocked` after the same reason occurs three consecutive times.

`OrchestratorSession` composes a `TaskRegistry`, event sink, mailbox, snapshot store, workspace manager, and memory store. A task is a typed node in a bounded DAG with dependencies, depth/fan-out limits, retries, deadline, cancellation policy, tool profile, workspace policy, artifacts, metrics and result envelope. Valid state transitions are enforced; task and result JSON are checked with AJV. The queue respects configured concurrency and propagates dependency success, failure, cancellation or blocking.

Task events redact secret-bearing fields before in-memory delivery or JSONL persistence. Snapshots are atomically written and validated on restore; interrupted running tasks become retryable failures. The mailbox deduplicates by message ID and records acknowledgement. Cross-process file leases protect memory, file writes, writer execution and integration.

Writer tasks use either a detached Git worktree or a serialized shared workspace fallback. Integration captures a binary patch, rejects protected/sensitive paths and overlap with parent changes, checks it with `git apply --check`, then applies it. Cleanup only removes an owned worktree after its integrated patch hash still matches.

## Tools

The model sees 23 built-ins: file read/write/line edit/patch/folder read, `grep`, `glob`, shell, Git, web fetch, LSP, introspection, todo, memory, knowledge update, mixture-of-agents, plan submission/writing, subagent/ask-agent, and create/get/update goal. MCP tools are appended only when `settings.mcp.enabled` explicitly permits project MCP loading.

All filesystem tools use canonical path resolution. They remain in the task workspace or an explicitly approved external directory, reject symlink escape, blocked metadata/dependency directories and sensitive credential names, and publish writes atomically under a lease. `web_fetch` fail-closes for invalid DNS, localhost, private/link-local addresses, cloud metadata, unsafe redirects, excessive redirects and timeout. LSP creates a short-lived JSON-RPC process only from user-scoped settings and supports definition, references, hover, document/workspace symbols.

The subagent tool maps roles to narrow tool sets, requires a typed terminal result, can work foreground or background, validates structured results, and optionally invokes an independent verifier. Fixed `coder`, `reviewer`, and `tester` profiles specialize this mechanism. The separate review pipeline fans out configured perspectives, deduplicates findings by hash, optionally verifies them, then runs a gap sweep.

## User interaction

The command registry parses 38 slash commands into typed `CommandResult` values. It covers model/configuration, plans/review, provider/session/checkpoint/cost/context actions, agent/skill/plugin management, goals, worktrees, task DAG control, permissions, memory, experimental features, mobile QR and diagnostics.

`ui/App` binds the agent to TUI state: history, streamed text and reasoning, current tool, token/context counters, interaction mode, message queue, side question, dialogs, diff viewer, configuration screens and persistent sessions. It subscribes to orchestration events to render subagent state and lets the user decide tool permission, plan approval, diff review and verification. The input layer supports queued prompts, fuzzy commands/files, paste, history, Vim motions/operators, cursor measurement and double-key safeguards.

Messages render Markdown, live thinking, terminal output, tools and structured file diffs. The status bar is responsive, showing mode, model, tokens, Git branch and context pressure. Six themes include light/dark, daltonized and ANSI variants.

## Local terminal renderer

`src/ink/` is an in-tree React renderer: React reconciliation builds a custom DOM tree, a TypeScript Yoga implementation calculates layout, terminal conversion produces ANSI frame updates, and screen diffing writes only changed physical cells. It owns resize, alternate screen, keyboard/paste/mouse dispatch, focus restoration, scroll clamping, Unicode grapheme widths, hyperlinks, cursor visibility and frame invalidation. UI code must use its public components and root APIs rather than write terminal frames directly.

## Extensibility and configuration

Plugins are cloned shallowly from a validated `owner/repo`, inspected for a manifest and component folders, stripped of `.git`, moved into the plugin directory and registered with commit metadata. Update stages a backup and restores it when replacement or registry update fails. Skills follow the same model but require a valid `SKILL.md` frontmatter manifest and a kebab-case name.

Settings merge in precedence order: legacy `~/.deepseek/config.json`, user `~/.deepseek/settings.json`, project `.deepseek/settings.json`, then local `.deepseek/settings.local.json`. Permission and hook arrays concatenate/deduplicate; normal arrays replace. Project/local scopes cannot activate Auto mode, executable hooks, LSP commands or MCP loading. Writers validate ranges and schemas, reject secrets, and atomically rename `0600` JSON output.

## Security-relevant invariants

| Invariant | Evidence |
|---|---|
| Filesystem access is workspace-contained and symlink-safe | `tools/shared/pathSafety.ts` |
| Sensitive filenames and agent metadata directories are not model-readable/writable | `pathSafety.ts` blocked/sensitive lists |
| High-risk rules cannot be disabled by a custom rule override | `permissions/risk.ts` merge policy |
| Permission denies win before allows | `permissions/matcher.ts` |
| Snapshots, events and session exports redact secrets | `orchestration/events.ts`, `snapshot.ts`, `session.ts` |
| Project MCP servers require user-scoped opt-in | `settings/repository.ts`, `agent/mcp.ts` |
| Task graph cycles, identity mismatches and unsafe restored workspaces are rejected | `TaskRegistry.ts`, `snapshot.ts`, `workspace.ts` |

## Removed / obsolete architecture

🟢 **CONFIRMED:** there is no current Hono proxy server, Playwright browser pool, relay package, OAuth proxy flow, `src/state/` store, or Vitest dependency. Existing prior documentation naming those components is obsolete. Tests run with Bun.
