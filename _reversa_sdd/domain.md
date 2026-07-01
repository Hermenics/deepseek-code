# Domain Model

> Confidence: 🟢 CONFIRMED (extracted from source code)  
> Generated at: 2026-07-01

## Ubiquitous Language (Glossary)

| Term | Definition | Source |
|------|-----------|--------|
| **Agent** | Core orchestrator class that manages the LLM conversation loop, tool execution, and context compaction. One instance per session. | `src/agent/agent.ts` |
| **Provider** | An LLM backend that the Agent connects to. Four supported: DeepSeek (native API), Bedrock (AWS), Vertex (GCP), Local (Ollama/LM Studio). | `src/types/provider.ts` |
| **Tool** | A capability the Agent can invoke during a conversation turn (e.g., shell, read_file, write_file). Each tool has a name, description, and JSON Schema parameters. | `src/tools/types.ts` |
| **Interaction Mode** | The current trust level of the session: `plan` (read-only), `build` (default, write with safety gates), `auto` (unrestricted). | `src/ui/interactionMode.ts` |
| **Risk Rule** | A declarative pattern that classifies tool invocations as `high` or `medium` risk. High-risk always requires confirmation; medium requires confirmation only in subagent context. | `src/permissions/risk.ts` |
| **Permission Rule** | A user-defined allow/deny pattern in settings that gates tool execution before the risk assessment layer. Uses glob matching. | `src/permissions/matcher.ts` |
| **Hook** | A shell command that fires at lifecycle events (PreToolUse, PostToolUse, SessionStart). Can approve, block, or modify tool input. Only loaded from user-level settings (security). | `src/hooks/types.ts` |
| **SubAgent** | A child agent spawned by the `subagent` tool to perform a delegated task. Has a role-based tool filter and its own iteration limit (15). | `src/tools/SubAgent/` |
| **SubAgent Role** | One of `reader`, `writer`, `executor`, `reviewer`, `unrestricted`. Determines which tools the subagent can access. Inferred from task description. | `src/tools/SubAgent/permissions.ts` |
| **Effort Level** | Controls reasoning depth sent to the LLM: `low`, `high` (default), `max`. DeepSeek API maps low→high internally, so only high/max have distinct behavior. | `src/commands/types.ts` |
| **Auto-Compact** | Automatic context summarization triggered when context usage reaches 85% of the model's limit. Preserves recent tool results while summarizing older messages. | `src/services/compact/` |
| **Micro-Compact** | A lighter compaction that clears old tool result contents (keeping the last 5) without a full summarization LLM call. | `src/services/compact/autoCompact.ts` |
| **Boundary Marker** | A special message inserted into the conversation to mark the compaction point. Messages before it are summarized; messages after are preserved verbatim. | `src/agent/compactBoundary.ts` |
| **Memory** | Persistent key-value store (markdown files) for agent knowledge and user preferences. Split into `agent` memory (MEMORY.md) and `user` memory (USER.md). Capped at 2000 chars total. | `src/agent/memory.ts` |
| **Steering** | Custom system prompt fragments loaded from `.deepseek/steering/` that are prepended to the base system prompt. | `src/agent/steering.ts` |
| **DeepSeek.md** | A project-level instruction file (similar to CLAUDE.md) that gets appended to the system prompt. | `src/agent/steering.ts` |
| **Settings** | Three-level configuration (user → project → local) merged with increasing priority. Project/local settings have hooks stripped for security. | `src/settings/` |
| **MoA (Mixture of Agents)** | A tool that queries multiple LLM models in parallel and synthesizes their responses through an aggregator model. | `src/tools/MoA/` |
| **Proxy** | A Hono HTTP server that translates OpenAI/Anthropic API formats into DeepSeek browser API calls via a Playwright page pool. Used for the browser-based DeepSeek provider. | `src/agent/providers/proxy/` |
| **Path Sandbox** | Security layer that restricts file access to the current working directory, blocks sensitive files, prevents symlink traversal, and denies access to config directories. | `src/tools/shared/pathSafety.ts` |
| **File Checkpoint** | Snapshots of file state before tool modifications, enabling undo/rollback. Max 10 entries in the undo stack. | `src/agent/fileCheckpoint.ts` |
| **Remote Control** | E2E-encrypted mobile pairing system using Curve25519 key exchange. Allows controlling DeepSeek Code from a phone via QR code. | `src/remote/`, `src/commands/rc/` |
| **Prompt Refiner** | Optional pipeline that rewrites user messages to be more effective for the LLM, triggered for messages > 30 chars that aren't commands. | `src/agent/promptRefiner.ts` |
| **Command** | A slash-prefixed user input (e.g., `/help`, `/model`, `/effort`) that is handled directly by the CLI rather than sent to the LLM. | `src/commands/` |
| **Audit Log** | Append-only log of all tool invocations and their outcomes, stored per session. | `src/agent/auditLog.ts` |

---

## Domain Rules

### R01 — Agent Iteration Limit 🟢
The agent loop terminates after 100 iterations to prevent infinite loops. If reached, an error message is appended and the loop breaks.

### R02 — SubAgent Iteration Limit 🟢
SubAgents have a stricter iteration limit of 15 (`SUBAGENT_MAX_ITERATIONS`).

### R03 — Context Auto-Compact Threshold 🟢
Auto-compaction triggers when `contextUsage / contextLimit >= 0.85`. The threshold is configurable via settings (`autoCompactThreshold`).

### R04 — Memory Size Cap 🟢
Combined memory entries (agent + user) must not exceed 2000 characters total. Additions that exceed this are rejected.

### R05 — Hooks Only From User Settings 🟢
Hooks defined in project-level or local-level settings are **stripped** before merging. Only user-level settings (`~/.deepseek/settings.json`) can define hooks. This prevents a malicious repository from executing arbitrary shell commands.

### R06 — Deny-First Permission Resolution 🟢
Permission rules are evaluated in order: deny rules checked first → if any match, deny immediately. Then allow rules → if any match, allow. If allow rules exist but none match, decision = `ask`. If no rules defined at all, decision = `allow`.

### R07 — Risk Confirmation in Build Mode 🟢
In Build mode, high-risk tool invocations always require user confirmation. Medium-risk invocations require confirmation only when executed by a subagent (not the main agent).

### R08 — Auto Mode Bypasses All Checks 🟢
When interaction mode is `auto`, all permission checks, risk assessments, and mode restrictions are skipped entirely. The model goes to auto mode only via user action (Shift+Tab) — the model itself cannot activate auto mode (`canModelActivateMode('auto') === false`).

### R09 — Path Sandbox Enforcement 🟢
All file operations must satisfy:
1. Path resolves inside `process.cwd()`
2. Path is not inside a blocked directory (`.git`, `.deepseek`, `node_modules`, `dist`, `build`, `.agent`, `.claude`, `.kiro`, `.github`)
3. Real path (after symlink resolution) still inside cwd (anti-traversal)
4. File is not a sensitive pattern (`.env*`, `*.pem`, `*.key`, `credentials*`, etc.)

### R10 — SSRF Protection 🟢
WebFetch tool blocks:
- Localhost/loopback addresses (127.0.0.1, ::1, 0.0.0.0)
- Cloud metadata endpoints (169.254.169.254, metadata.google.internal)
- Private network ranges (10.x, 172.16-31.x, 192.168.x)
- Link-local (169.254.x)
- After DNS resolution: the resolved IP is re-checked against private ranges

### R11 — Glob Wildcard Safety Limit 🟢
Glob patterns with more than 10 wildcards are automatically rejected (return false) to prevent ReDoS-style pathological matching.

### R12 — Settings Merge Priority 🟢
Settings are merged in order: user (lowest) → project (medium) → local (highest). Arrays are concatenated and deduplicated. Objects are deep-merged one level. Scalars are overridden by higher-priority levels.

### R13 — Parallel Tool Execution 🟢
Tools in the `PARALLEL_SAFE` set (`subagent`, `shell`, `grep`, `glob`, `read_file`, `read_folder`, `web_fetch`, `introspect`) can execute concurrently. Mixed batches or write tools always execute sequentially.

### R14 — SubAgent Role Inference 🟢
Role is inferred from the task description using keyword matching:
- Read-only keywords without write keywords → `reader` (or `reviewer` if audit/review)
- Write keywords without execution keywords → `writer`
- Default fallback → `executor`

### R15 — Undo Stack Limit 🟢
File checkpoints are capped at 10 entries (`UNDO_STACK_MAX`). Oldest entries are evicted when the limit is reached.

### R16 — Prompt Refinement Guards 🟢
Prompt refinement only triggers when:
1. Feature is enabled in settings
2. Message length > 30 characters
3. Message doesn't start with `/` (command) or `!` (shell)

### R17 — Shell Output Truncation 🟢
Shell command stdout/stderr is truncated to 50,000 characters (`SHELL_OUTPUT_MAX_CHARS`).

### R18 — Shell Command Timeout 🟢
Shell commands timeout after 30 seconds (`SHELL_TIMEOUT_MS`) by default.

### R19 — Hook Timeout 🟢
Each hook command has a timeout of 30 seconds by default (configurable per hook).

### R20 — PostToolUse Hook Result Cap 🟢
Tool results sent to PostToolUse hooks are capped at 10,000 characters to prevent memory issues.

### R21 — MoA Minimum Responses 🟢
MoA requires at least 1 successful reference model response (`minResponses: 1`) before proceeding to aggregation. Timeout per model is 60 seconds.

### R22 — Content-Scoped Risk Approval 🟢
When a user approves a high-risk tool invocation, the approval is scoped to the specific content (command string or file path), not the entire rule. This prevents blanket approval of dangerous operations.

### R23 — Checkpoint Max Storage 🟢
Maximum 20 session checkpoints are stored on disk (`CHECKPOINT_MAX`). Older checkpoints are evicted.

---

## Domain Invariants

| ID | Invariant | Enforcement |
|----|-----------|-------------|
| INV-01 | A session has exactly one Agent instance | Constructor pattern in `cli.tsx` |
| INV-02 | Tool execution always follows the pipeline: mode check → risk → permission rules → hooks → execute | `checkAndExecuteTool()` sequential checks |
| INV-03 | No file write can escape the cwd sandbox | `assertSafePath()` called before every write/read |
| INV-04 | Hooks cannot be injected via project files | `stripHooks()` in settings loader |
| INV-05 | Auto mode can only be activated by the user, never by the model | `canModelActivateMode('auto') === false` |
| INV-06 | SubAgent cannot spawn another SubAgent | Tool filtered out of subagent tool list |
| INV-07 | DenyAbortError terminates the entire turn | Thrown → caught at runLoop level → cb.onDone() |
