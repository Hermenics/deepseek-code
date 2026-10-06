# Changelog

## 0.11.0

- Added: Persistent Pods run named agents from a supervised queue with saved conversations, routines, notes, signed event delivery, groups, an authenticated web panel, and optional deployment to an existing Debian or Ubuntu host.
- Fixed: Browser frame capture waits for the selected page target to resume before attaching, avoiding a race during navigation.

## 0.10.0

- Added: The idle fullscreen home screen now reuses the star field and ocean-wave patterns from `WelcomeScreen`, animates the whale across the scene, and shows a short welcome message with useful input shortcuts. It appears only when the session is empty and the terminal has room for it.
- Changed: The header now scrolls with the transcript instead of remaining pinned, so it no longer takes a permanently reserved strip above the conversation.
- Enhanced: Inline sessions and terminals too small for the animation keep the whale in its original header position; the animated scene is limited to fullscreen terminals at least 70 columns by 24 rows.
- Enhanced: The whale blinks by briefly changing its eye from `◉` to `─`, both in the animated scene and the header fallback; reduced-motion settings keep the eye static and stop the swimming animation.
- Changed: Removed the “Don't like this screen? Change it in /config” hint from above the input.
- Fixed: The installed `deepseek` launcher starts Bun through Node.js 18+ without importing the current project's `.env` or `bunfig.toml`, while preserving environment variables explicitly exported by the user.
- Fixed: `web_fetch` approvals now apply only to the approved origin, and Project or Local settings cannot enable `permissions.autoApproveLowRisk`; prompts identify the URL and approval scope, which `/permissions` also explains.
- Added: Vision-capable models can receive prompt images through a one-turn, untrusted payload that is not written to session history; provider profiles can set image input to Auto, On or Off, and `/model` identifies models that accept images.
- Fixed: MCP image forwarding and cancellation now work with image-bearing requests, and draft 2020-12 JSON schemas no longer break MCP tool calls.
- Added: The opt-in `browser` tool controls an installed Chromium-family browser through a debugging pipe and temporary profile, with accessibility snapshots, native input, navigation, tabs, dialogs, screenshots, console/network inspection, `expect`, batched actions and Playwright test export.
- Added: Browser navigation and interaction require origin approval; public-page typing asks each time, sensitive fields and private-network targets are blocked, and redirects or popups cannot bypass the check. Page content remains marked as untrusted input.
- Added: `/browser` exposes status, show, hide and close controls plus a status-bar page indicator; `dev_server` reads `.deepseek/launch.json` or `.claude/launch.json`, approves each new or changed launch configuration, waits for readiness, bounds logs, prevents port conflicts and stops the process tree at session or project end.
- Added: Browser handoff supports device and color emulation, workspace-only uploads, quarantined downloads capped at 50 MB and deleted when the browser closes, and reference marks on screenshots.
- Enhanced: Browser actions report newly observed console/network errors and request bodies; missing favicons are ignored, and errors found between turns are delivered to the agent on its next turn.
- Tests: Browser evals can run in isolated workers and in parallel, save transcripts, and compare pass rates with uncertainty, paired differences and cost-per-pass metrics.

## 0.9.0

- Added: Press Left on an empty prompt to open the command center and switch between saved sessions across projects, or start a fresh session without leaving the CLI
- Added: The command center shows the live session alongside saved ones, with status filters, project/status/model grouping, search, details, rename and confirmed deletion; switching away from active work is blocked
- Enhanced: Resuming or reopening a saved session keeps its original ID, so later saves update that record instead of creating duplicate continuations; a missing project directory gets a fresh ID
- Enhanced: Consecutive file reads, searches and directory listings collapse into a compact transcript summary; Ctrl+O reveals individual calls and their output, while running tools stay with their active step
- Fixed: Tool failures show an error status, structured results get summarized before clipping, and input cursor movement follows the same word wrapping shown on screen; navigating multiline prompt history remains consistent
- Fixed: Existing plugin MCP configuration paths are canonicalized before workspace approval checks

## 0.8.2

- Added: Skills from native, project, user and installed-plugin locations; the prompt carries their descriptions, and the read-only `skill` tool loads matching instructions and bounded companion text only when needed
- Added: Installed plugins can contribute live slash commands, skills and MCP servers; plugin commands use `/plugin-name-command`, and MCP settings can resolve `${PLUGIN_ROOT}` to the plugin directory
- Enhanced: Plugin MCP servers follow User-scoped MCP enablement and require workspace approval tied to their config and installed plugin revision; plugin install, update and removal refresh skill and MCP contributions in the active session
- Fixed: Extension loading rejects paths that escape their declared roots, including symlink escapes, and refreshes the live command suggestions after plugin changes
- Docs: README and extension research now describe the skills, plugin and MCP runtime; the landing page and guides reflect the shipped behavior
- Tests: Cover on-demand skill loading, plugin command discovery and refresh, workspace approval for plugin MCP configs, and extension cleanup

## 0.8.1

- Enhanced: After installing an update, the CLI clears the terminal and asks you to restart manually, avoiding an automatic process relaunch

## 0.8.0

- Added: Research evidence extraction accepts URLs without a scheme, such as `example.com`, and resolves them as HTTPS URLs
- Added: Named steps — the agent plans its work before the first tool call and opens each group of tool calls with the new `step` tool, giving it a present-tense label shown while it runs ("Running the tests") and a past-tense one once it ends ("Ran the tests")
- Added: A step stays open across model responses until the next one opens or the turn ends, and the runtime announces it before its batch runs, so parallel calls always land in the right group
- Added: The system prompt teaches the model to plan its steps up front and to open each one in the same response as its first tool calls
- Enhanced: A running step shows its label in bold with animated dots (`.` → `..` → `...`), or static dots with reduced motion, and its tool calls indented beneath it
- Enhanced: Once the turn ends, steps collapse into "Work truncated" with the rest of the work; ctrl+o shows every step with its tools
- Fixed: A step cut short by Ctrl+C, a denied permission or an error keeps its present-tense label and is marked `✗ … · interrupted`, instead of looking finished
- Tests: The step tool and its modes, step announcement order in a parallel batch, step open/close/interrupt helpers, running, interrupted and collapsed step rendering, and the dot animation frames

## 0.7.10

- Fixed: The exit screen only offers `deepseek --resume <id>` when that session was actually saved; quitting before any model turn used to print a resume command for a session that did not exist
- Fixed: Resizing the terminal width in fullscreen no longer leaves a long conversation collapsed toward the top or overlapping the input; text is re-measured and the layout recomputed on every column change
- Fixed: Relaunching after an automatic update waits for the new process instead of exiting under it, so the relaunched session keeps control of the terminal instead of failing with `setRawMode failed with errno: 5`
- Fixed: On macOS, `grep` no longer uses the system grep, which accepts the flags the tool relies on but breaks its output format together with `--include`
- Fixed: `scripts/update-deepseek-models.ts` removes HTML tags repeatedly until none are left and decodes entities only afterwards, so nested or entity-encoded markup can no longer survive into the model catalog
- Chore: `bun test` discovers only the `tests` directory, so the intentionally failing eval fixtures under `scripts/eval/tasks` are never picked up by the unit suite
- Tests: Session resumability, the exit screen without a saved session, relaunch waiting for the child process, long-content fullscreen resize, and a longer CI timeout with a steadier search-tool test

## 0.7.9

- Added: Goal completion is checked by a separate, tool-free request to the current model: `update_goal` with `status=complete` now requires a `completion_summary`, and the goal stays active unless the reviewer finds explicit, credible evidence that every part is done
- Added: `release.sh --ai` asks Codex to recommend a patch, minor or major bump from the commits since the latest tag, and asks for confirmation before releasing with it; passing an explicit version still works
- Docs: The landing page gains an interactive terminal demo, the documentation pages are refreshed, and the changelog now covers versions 0.1.1 to 0.1.3

## 0.7.8

- Enhanced: A turn is no longer stopped after 100 tool iterations; the agent keeps working until the task is done
- Enhanced: Subagents have no fixed 50-iteration cap; one started without a task context stops after two minutes instead
- Added: `read_file` and `read_folder` take `paths` to read several files or list several directories in one call, and `grep` takes `patterns` to run several searches at once
- Added: `git` has a read-only `batch` action that runs several status, diff or log operations in one call, and `todo` gains `remove` and an ordered `batch` of add, update and remove operations
- Enhanced: Permission rules are checked for every path, pattern or git operation in a batched call; one denied item denies the whole call and one item that needs approval asks for it
- Enhanced: Fullscreen pins the header only while more than 21 rows remain for the conversation; on a short terminal, or while a model, effort, question, permission, plan or confirmation prompt is open, it scrolls with the transcript
- Fixed: `web_fetch` decodes HTML entities before stripping tags, so entity-encoded markup can no longer turn back into tags in the text given to the model
- Docs: The architecture, file operations, large codebases and permission pattern pages describe batched paths and patterns
- Tests: Batched paths, patterns and git operations with their permission decisions, the subagent time limit, and the pinned-header layout

## 0.7.7

- Enhanced: The TUI has its own "Sonar" look instead of a Claude Code-like one — a rounded input box with the agent label in its border, a user bar, an assistant diamond, tool lines with their status on the right, a sonar-pulse spinner, a braille wave while thinking, and an end-of-turn wave line with the duration and tool count
- Enhanced: Fullscreen keeps the header pinned above the scrolling conversation, and the ctrl+o full-mode bar sits under the input box
- Fixed: Raw mouse coordinates (like `2;10M`) no longer leak into the prompt when a mouse report arrives split across reads
- Fixed: Closing the terminal (or its tmux session) now exits the app; it used to keep running forever with no terminal, rendering in the background, and ignored `kill`
- Fixed: The published bundle is a production build; it used to run as a development build that wrote `~/.deepseek/logs/dev.log`, silently swallowed every uncaught exception and shipped React's development renderer. An uncaught exception now restores the terminal, prints the error and exits, and unhandled rejections are recorded in the session log
- Fixed: In inline mode the `/` and `@` dropdowns open below the input instead of covering the header of an empty chat
- Fixed: Tab on a suggested reply only puts it in the input for editing; Enter sends it
- Fixed: Each database migration runs in one transaction, so a failure rolls back its partial schema changes and fresh databases need fewer disk syncs
- Tests: `reject` failing closed at the permission, risk, agent-config and workflow prompts, a free repro of the silent turn end on an outside-workspace deny, subagent cost enforcement and aggregation, and the compare statistics; mouse reports split across reads, the launcher exiting on SIGTERM/SIGHUP (skipped on Windows), the Tab suggested-reply path, and atomic migration rollback

## 0.7.6

- Added: `scripts/eval/compare.ts` compares two eval labels — pass rate with a 95% Wilson interval, the paired difference per task, a 90% bootstrap interval that resamples tasks and then runs, cost per pass at one fixed price, and the promotion and 30–70% rotation rules
- Added: Every eval record now carries `outcome` (pass, agent_fail, timeout, budget, infra_error, deny_abort), `hiddenPass`, a hash of the diff, the base URL host (never the key), effort, budget level and `fixedCostUsd`; old results stay readable and `pass` keeps its meaning
- Added: `--effort low|high|max` on the eval runner, and memory is switched off for eval runs with `DEEPSEEK_DISABLE_MEMORY=1` so runs cannot learn from one another
- Added: Three hard eval tasks — `batch-loader-rejection` (same failure family as `inflight-dedup`), `harness-quirk` (the bug is in a test helper and scratch files must be cleaned up) and `distant-cause` (the symptom is four files away from the cause, and the hidden check covers the other callers)
- Added: Four more hard eval tasks after the re-baseline saturated the first set — `swr-background-refresh`, `generated-do-not-edit` (the fix belongs in the generator, and regenerating must reproduce the committed file), `semver-ranges` (npm range and prerelease semantics, checked against the `semver` package) and `convention-ambiguity` (the new method must follow the repository's Result, error-code and logger conventions)
- Added: A permission handler can answer `reject`: on a path outside the workspace the model gets a path error and the turn continues; for every other kind of request it fails closed exactly like `deny`. The eval runner now answers `reject` instead of ending the turn
- Enhanced: The environment block tells the model that shell commands see the working directory at `/mnt`, while file tools use the real path
- Fixed: A streaming request that goes silent for two minutes (`DEEPSEEK_STREAM_IDLE_TIMEOUT_MS`) is aborted and retried when nothing had arrived yet, and fails the turn with a clear error when it stalls mid-answer, instead of holding the turn until the caller gives up
- Fixed: A denied tool call is reported through `onToolCall` before the turn stops, so it shows up in the UI and in eval records instead of vanishing
- Fixed: Subagents price their full usage (cache misses, cache hits, output) with the shared cost table, so `maxCostUsd` — including the $0.50 cap of the "I'm broke" level — is enforced, and stops the subagent mid-run instead of never firing
- Fixed: Subagent and verifier spend is added to the session cost shown by `/cost` and used by budgets
- Fixed: Subagents on the official DeepSeek API request the same output ceiling as the main agent instead of the 4K default that truncates long file writes
- Fixed: The eval runner's header promised that destructive shell commands were denied; it grants them per session, and now says so
- Tests: `reject` failing closed at the permission, risk, agent-config and workflow prompts, a free repro of the silent turn end on an outside-workspace deny, subagent cost enforcement and aggregation, and the compare statistics

## 0.7.5

- Added: A spending level (`budget`) in Settings / Agent Behavior — "I'm broke", "I'm comfortable" and "I'm loaded" — moving thinking depth, delegation width, model review and compaction together, so the choice is about the wallet instead of six separate knobs
- Added: The middle level is exactly the behaviour the build already had, and every level merges underneath your own settings files, so a limit you wrote by hand is never undone by picking a level
- Added: Mechanical verification of delegated work — the real `git` diff compared against what the subagent declared, the existence of every path it cited, and an optional `agents.verifyCommand` that its changes must survive
- Added: The mechanical checks cost no tokens, run at every spending level, and can refute a result on their own, so no model's approval sits on top of a failing build or an edit that was never mentioned
- Enhanced: A subagent's role is an explicit parameter defaulting to read-only, replacing keyword matching over the task description, which granted a shell for "check if the build passes" and withheld writes for "fix the typo"
- Enhanced: Verification is chosen by what the agent did rather than by the confidence it reported, so a result that is certain and wrong is still checked
- Enhanced: The verifier receives the mechanical findings and every claim the candidate made, and is asked to read the changed files itself rather than trust the summary
- Enhanced: A base URL with no path is treated as an OpenAI-compatible server and reaches `/v1`; DeepSeek's own host and any path you wrote are left as they are
- Enhanced: Provider types are named after what actually differs between them — "Local model (no API key)" sends no credentials, and an authenticating proxy belongs under DeepSeek API with a base URL
- Fixed: A terminal that disappears mid-session — a closed window, a dropped SSH connection, a recycled pty — no longer takes the whole interface down with `setRawMode failed with errno: 5`
- Fixed: Restoring the terminal on the way out no longer skips leaving raw mode when the reset sequences cannot be written, which could leave a shell unusable
- Fixed: Settings applied immediately after startup are no longer reverted by the load the session begins with
- Fixed: Empty setup fields no longer render a literal `…` that reads as text waiting to be deleted
- Fixed: The settings list follows the terminal width instead of a fixed 38 columns, so labels and category descriptions stop being clipped on a roomy terminal, and a label never runs into its value
- Fixed: While a settings field is open for editing, only the keys that actually work there are listed, instead of four stacked lines offering keys that would be typed into the field
- Tests: Coverage for budget resolution and its precedence rules, mechanical grounding against a real repository, base URL normalization, raw mode on a revoked terminal, and settings column layout

## 0.7.4

- Added: Provider profiles — save, edit, test and switch between named provider configurations, kept in `~/.deepseek/provider-profiles.json` with private file permissions
- Added: `provider.activeProfileId` selects the active profile and is accepted only at User scope; a provider change requested during a turn applies once that turn finishes
- Enhanced: `testProviderSettings` became `testProviderConfig` and takes a provider configuration directly, so a profile can be tested before it is activated
- Fixed: Hook commands, `!` shell commands and the subagent status line run verbatim through `cmd.exe` on Windows; the default argument escaping turned a command's own quotes into `\"` and `cmd /s` then ran a mangled command
- Tests: Cross-platform CI fixes — background shell tests skip without bubblewrap, the Bedrock mock no longer leaks `fromEnv` into the MoA tests through the process-wide module mock, and the tool-call error boundary test waits for initialization instead of relying on platform timing

## 0.7.3

- Added: Completion checks before a turn ends: a failed post-edit verification is fed back to the model (up to two retries per turn), todo items added or updated during the turn are raised once in Build and Auto modes, a reply with no text and no tool calls is sent back for another attempt, and a reply cut off at the output-token limit continues automatically (up to three times)
- Added: `readBeforeEdit` feature flag, on by default, rejects `write_file`, `edit_file` and `patch_file` changes to an existing file the agent has not read or that changed on disk since it was read
- Added: `/cost` shows the real DeepSeek account balance and how much it moved during the session, next to the local estimate
- Added: DeepSeek models, context limits and prices are synced from the official pricing page into one data file used by `/cost`, context accounting and the website, with a daily workflow that opens a pull request when they change
- Added: Agent quality eval (`scripts/eval/run.ts`) with hidden-check tasks, per-run and total budgets, real balance tracking and saved transcripts of failed runs
- Enhanced: Cost estimates use peak and off-peak rates, price each response at the model active when it arrived, and include compaction and automatic memory extraction
- Enhanced: A tool call that fails identically three times in a turn tells the model to change approach, and reaching 100 tool iterations stops the turn with a notice that keeps the work and says how to resume
- Enhanced: Goals continue for up to 10 turns by default and pause after 2 consecutive turns without tool calls or file changes
- Enhanced: `edit_file` returns the edited lines at their new numbers; `patch_file` matches LF snippets in CRLF files and points at the closest match when `old_content` is not found
- Enhanced: The system prompt asks the agent to state its hypothesis before editing, review its own diff, and ask the user early and in batches
- Fixed: Aborting the plan approval dialog stops the turn instead of letting the agent keep working, and approving a plan returns to the previous mode, so Auto stays Auto
- Fixed: `write_plan` works in Plan mode entered with `Shift+Tab`, and `submit_plan` no longer pauses an Auto-mode session
- Fixed: Verification treats a project without tests as passing for bun, jest, vitest and mocha, inside AI agents and regular terminals and with colored output, while import and configuration errors still fail
- Fixed: Automatic memory extraction runs once per turn instead of on every runtime check
- Docs: Website model, limit and pricing tables are generated from the synced data, and the goals, file operations, interaction modes, feature flags, verification, pipe mode and cost accounting pages describe the new behavior
- Tests: Add coverage for completion checks, read-before-edit, plan tools, balance and cost reporting, pricing-page parsing, goal progress, verification output formats and CRLF patches

## 0.7.2

- Added: Image attachments in the prompt — paste clipboard images with `Ctrl+V` or bracketed paste (Linux, macOS and Windows clipboard readers) and they appear as atomic `[Image #n]` placeholders that are deleted as one unit
- Added: Terminal file drops are recognized as paths (direct, shell-escaped, quoted, `file://` URIs and quoted Windows UNC paths) and inserted into the prompt
- Added: Images are sent as OpenAI-compatible `image_url` parts; only images whose placeholders survive editing are sent, and queued prompts and `/retry` keep their attachments
- Enhanced: The default DeepSeek model is now `deepseek-flash`, with native visual understanding, pricing and a 1M context window
- Enhanced: A single prompt accepts up to 20 images and 100MB of encoded image data; images beyond either limit are rejected with an inline notice and existing attachments are kept
- Fixed: Compaction serializes images as `[Image: type]` markers instead of base64 data, and no longer fails on assistant tool-call messages with empty content
- Fixed: Prompts queued during a turn are still submitted when that turn ends with an error
- Fixed: Relaunching after an update hands the terminal to the new process immediately, so two processes no longer read the same input stream
- Tests: Add regression coverage for clipboard image decoding, dropped-path normalization, image placeholder remapping and deletion, multimodal prompt content, compaction serialization and `deepseek-flash` pricing

## 0.7.1

- Added: Context limits are discovered from the provider's own model metadata (`context_length`, `context_window`, `max_input_tokens` and the like), so a model the build has never heard of still compacts at the right point
- Added: An official model catalog is consulted for descriptions before asking a model to research an unknown ID, and context sizes are shown as `1M context` or `400k context` in the model selector
- Enhanced: Model IDs carrying a provider prefix (`vendor/model`) resolve to the same entry as the bare ID for both context limits and descriptions
- Enhanced: A cached model description is kept only when it carries an `http(s)` source URL and says something specific; generic filler such as "AI model variant" or "context window unknown" is discarded rather than shown
- Fixed: Dropdowns render opaque, so the text underneath no longer shows through the command and file suggestion lists
- Fixed: The command dropdown keys rows by position, so duplicate command names no longer collide during rendering
- Tests: Coverage for context-limit discovery, model description filtering and prefixed model IDs

## 0.7.0

- Added: Dynamic Workflows reach parity with Claude Code's Workflow tool — `pipeline` stages receive `(previous, item, index)`, `budget` exposes `total`, `spent()` and `remaining()` (`Infinity` when unbounded) plus cost accessors, `workflow()` accepts `{ scriptPath }` as well as a saved name, `meta` accepts `whenToUse` and per-phase `model`, and `agent()` accepts the `low`/`medium`/`high`/`xhigh`/`max` effort tiers
- Added: The `workflow` tool accepts `scriptPath`, a saved workflow `name`, and `resumeFromRunId`; every result now carries `scriptPath` and `journalPath`, and resuming replays the journaled result of every unchanged `agent()` call so an edited script only reruns from the first edited call
- Added: Runs are located across earlier sessions of the same project, child workflow agents are grouped under `▸ name` in the monitor, and reading persisted workflow scripts and journals no longer prompts for outside-the-project access
- Added: The activity footer now presents live agents and workflows in one navigable surface, keeps paused workflows and recently completed agents addressable, groups nested agents, shows live token/decorations, and marks runs owned by another session as read-only
- Added: `shell` accepts `background=true` to create a controllable task handle with the same workspace, permission, timeout and cancellation rules as foreground execution
- Added: An optional user-scoped `interface.subagentStatusLine` command receives the current activity snapshot as JSONL and can decorate footer rows; execution uses a scrubbed environment, bounded output and a hard timeout
- Added: An `<environment>` packet (working directory, Git branch, platform, OS, shell, model, date) is delivered with the project context so models stop guessing where they are
- Added: `model.maxOutputTokens` and `model.temperature` settings; the official DeepSeek API now always receives `max_tokens` so long file writes are no longer cut off at the provider's small default
- Enhanced: The system prompt is rewritten as a compact, concrete operating guide (task loop, tool selection, scope discipline, care with irreversible actions, modes, communication) instead of an abstract policy manual; effort hints no longer inject generic "think step by step" filler
- Enhanced: The `workflow` tool description documents the full script API with a canonical review-then-verify example, discourages self-imposed token budgets, and the `read_file`, `write_file` and `shell` descriptions steer the model toward the right tool; `read_file` returns 500 lines by default
- Fixed: Tool calls whose arguments were cut off at the output-token limit or were otherwise invalid JSON are reported to the model as such instead of executing with empty arguments and surfacing as a schema error
- Fixed: `shell` results include the exit code or timeout, and long output keeps both its head and its tail so a failing test run's verdict survives truncation
- Fixed: Transient provider failures (408/409/5xx/529 and dropped connections) are retried with backoff, not only 429/503
- Fixed: Replaying a journal no longer carries a previous run's budget exhaustion into a run with a larger budget, per-call agent accounting is correct under parallel fan-out, budget-exhausted runs explain what was skipped, and child workflows run without prior approval in Auto mode
- Fixed: Activity counters no longer include workflow child agents, focused input is not sent to completed or shell tasks, retained terminal rows still open from the footer, and remote workflow activity refreshes without leaving stale rows; startup failures persist as terminal runs and release their leases
- Fixed: Status-line timeouts terminate the shell process group (and its descendants where supported) when stdout stays open, and each refresh uses the agent's current working directory instead of a stale startup path
- Fixed: The loading spinner only announces prompt refinement when the refiner is enabled
- Fixed: The status bar shows the configured model as soon as settings load, initialization warnings are surfaced in the transcript, and `/workflow restart` (or `resume` on an interrupted run) relaunches over the run's journal instead of rerunning completed agents
- Docs: Workflow reference updated in Introspect, the website and the project report for the new script API, tool inputs and resume flow
- Tests: Add regression coverage for pipeline stage signatures, budget shape, nondeterminism guards, `resumeFromRunId`, `scriptPath` resolution and containment, Auto-mode children, phase models, effort mapping, budget replay, argument-parse feedback, shell truncation/background lifecycle, footer selection and retention, status-line trust/timeout/cwd, remote workflow polling, startup failure persistence and the environment packet

## 0.6.28

- Added: Complete lifecycle hook coverage for prompt expansion, additional directories, configuration changes and idle teammates, alongside the existing session, tool, permission, task, compaction and worktree events
- Added: Suggested reply ghost text generated after assistant responses, with `Tab` acceptance, local writing-style adaptation and the `ghostReplies` feature flag enabled by default
- Fixed: Suggested replies are rendered when the input is empty and disappear as soon as the user starts typing, without replacing or completing user input
- Fixed: Shell and command-prefixed outputs such as `!` and `/` are rejected as suggested replies, while stale asynchronous generations cannot overwrite a newer turn
- Tests: Add regression coverage for lifecycle hook expansion, local style statistics and empty-input suggested-reply rendering

## 0.6.27

- Enhanced: Replace the oversized static operator manual with a compact system core and a per-request runtime contract containing the active mode, supplied tools, allowlist, and current restrictions
- Fixed: Project guidance from AGENTS.md, DEEPSEEK.md, steering files, skills, and memory is delivered as a separate lower-authority context packet and survives session restore and compaction without diluting the system core
- Fixed: Tool schemas are filtered to the active interaction mode and Plan/Review schemas expose only their permitted read-only actions
- Enhanced: Prompt refinement is opt-in by default and preserves the original user request as authoritative context when enabled
- Docs: Keep detailed CLI, tool, workflow, and product reference available through Introspect instead of loading it into every system prompt
- Tests: Add regression coverage for context separation, dynamic runtime contracts, mode-aware tool payloads, compaction, session restoration, and prompt-refinement defaults

## 0.6.26

- Added: Session-scoped multi-root workspace access through explicitly approved additional directories, with canonical-path validation, path-safety checks, persistence, and the `/add-dir` command
- Added: `/branch`, `/batch`, and `/background` command flows, plus structured `/review` targets for diffs, branches, commits, pull requests, and paths
- Added: Configurable input keybindings shared across terminal and Web UI input handling
- Enhanced: MoA supports multi-perspective analysis batching with progress callbacks
- Enhanced: Ink rendering improves text wrapping, screen management, pointer selection, and drag handling
- Tests: Add comprehensive coverage for additional directories, new commands, review targets, keybindings, MoA progress, text wrapping, selection, and session branches

## 0.6.25

- Fixed: After accepting an interactive update, DeepSeek Code automatically relaunches the updated TUI with the original entrypoint, arguments, working directory, environment, and terminal streams preserved
- Fixed: InputBox no longer renders inline command or history autocomplete ghosts; the slash-command dropdown remains available
- Enhanced: InputBox displays argument placeholders such as `/goal [<condition> | clear]` without inserting them into the input
- Tests: Add regression coverage for update relaunch arguments and display-only input placeholders

## 0.6.24

- Added: Workspace trust for project, local and additional agents plus project MCP configuration, bound to canonical paths and exact SHA-256 content hashes
- Fixed: Project settings can no longer choose saved provider routing or grant permission allow rules; subordinate prompts and reference files remain untrusted guidance
- Fixed: Contextual shell execution now fails closed without a working Bubblewrap sandbox, while MCP processes use scrubbed environments, bounded connection/call timeouts and lifecycle cleanup
- Fixed: WebFetch rejects private destinations across DNS and redirects and bounds streamed response bodies; path, glob, plugin and log boundaries reject unsafe symlink or permission escapes
- Security: The website no longer loads mutable remote scripts or uses remote install bootstrap code, and now ships a restrictive CSP and deployment security headers
- Tests: Add regression coverage for workspace trust, settings boundaries, shell sandboxing, MCP lifecycle, SSRF, path safety and security headers

## 0.6.23

- Added: Explicit support for the real DeepSeek API model `deepseek-v4-flash-vision-exp`, including Flash-tier local cost rates and a hardcoded one-million-token context limit
- Fixed: `Work truncated` is no longer shown for reasoning-only turns; it requires tool or terminal work
- Docs: Expand the website reference for current DeepSeek API models and peak/off-peak pricing, model limits, commands, workflows, providers, sessions, tools and interface behavior
- Tests: Add regression coverage for Vision cost/context handling and reasoning-only transcript rendering

## 0.6.22

- Added: Live Dynamic Workflow progress in the Web GUI — phase, status, agent/token usage and `log()` output stream while a workflow runs instead of surfacing only the final tool result
- Added: Blocked subagents now reach the Web GUI with their block reason, a task state the orchestrator callback layer never routed
- Added: Web slash-command parity with the terminal for `/sessions`, `/memory`, `/goal`, `/tasks`, `/task`, `/cwd`, `/worktree`, `/doctor`, `/verify`, `/catalog`, `/permissions`, `/context`, `/features`, `/agents`, `/agent`, `/skill`, `/plugin`, `/retry`, `/logout`, `/workflow`, `/workflows`, and `/model` without arguments
- Added: Saved workflows and project/user custom commands now resolve in the Web GUI, which previously used the base parser instead of the shared command resolver
- Enhanced: Terminal-only commands (`/vim`, `/quit`, `/config`, `/gui`, `/mobile`) explain why they do not apply in the browser instead of returning a generic unsupported notice
- Fixed: Web GUI live trace no longer opens a new row for every streamed tool-argument fragment, so one tool call renders as one entry
- Fixed: `/cwd` and `/worktree` no longer report a successful workspace move when the agent cannot change directory, and worktree relocation is refused before an orphan worktree is created
- Tests: Add regression coverage for workflow progress forwarding, blocked-subagent reporting, Web slash-command actions, and workspace-move capability guards

## 0.6.21

- Note: Accidental version bump. This release contains no product changes — only `package.json` and `package-lock.json` were touched.

## 0.6.20

- Added: Project and user custom slash commands from `.deepseek/commands/*.md`, with argument expansion and safe discovery across workspace ancestors
- Added: Skill creator guidance and validation for portable `SKILL.md` files, including malformed frontmatter, duplicate keys, unreadable files, and placeholder checks
- Enhanced: TUI work summaries now show a subtle `Worked for` line only after a turn finishes, while active work remains fully visible
- Enhanced: Command resolution now uses explicit built-in → workflow → custom precedence and refreshes custom commands after `/cwd` and worktree changes
- Fixed: `.deepseekignore` prompt state now requires an exact boolean `true` and is suppressed process-locally even when persistence fails
- Fixed: Setup prevents duplicate saves, clears stale provider fields between attempts, and distinguishes authentication, service, and connectivity failures when checking the official DeepSeek API
- Fixed: TUI divider labels are truncated to the available terminal width instead of overflowing
- Tests: Add regression coverage for command collisions, HTTP service-error statuses, divider width limits, custom commands, ignore behavior, setup health checks, and skill validation

## 0.6.19

- Fixed: TUI exit now clears the terminal, prints the blue DEEPSEEK CODE resume banner in full, and leaves the shell prompt below it without alternate-screen or stdout ordering artifacts
- Tests: Add regression coverage for Unicode banner rendering, terminal cleanup sequences, and session-resume output ordering

## 0.6.18

- Fixed: `/gui` now resolves the CLI entrypoint and launches the browser workspace from the agent's active working directory
- Fixed: GUI subprocess failures and non-zero exits are reported in the TUI instead of leaving a false "Opening" state
- Fixed: Explicit `/quit` and TUI cleanup terminate the detached GUI process through one shared lifecycle helper
- Docs: Document `/gui`, its separate Web session, browser launch behavior, and lifecycle in Introspect
- Tests: Add regression coverage for `/gui` command parsing and command registry exposure

## 0.6.17

- Added: Local browser workspace with WebSocket agent bridge, streaming responses, thinking/tool activity, telemetry, todos, source control, terminal PTY, and session replay
- Added: Web UI support for Conversation, Source Control, Terminal, available tools, live trace, approvals, questions, plans, and responsive light/dark themes
- Added: Browser-side command autocomplete, streamed response formatting, fixed-bottom composer, stop-agent control, and local session restoration
- Added: Web server entrypoint through `deepseek --web` with authenticated loopback access and persistent terminal support
- Tests: Add comprehensive WebSocket, terminal replay, source-control, bridge interaction, and security regression coverage

## 0.6.16

- Fixed: Session exports now resolve the requested workspace before loading a session, preventing cross-project exports when session IDs collide or legacy storage contains duplicates
- Fixed: Checkpoint restore rejects path-traversal IDs and only loads generated checkpoint identifiers from the checkpoint directory
- Tests: Add regression coverage for workspace-scoped session exports and checkpoint path traversal

## 0.6.15

- Added: Interactive `ask_user_questions` tool for agent-user dialogue, supporting choice, free-form text, yes/no questions, numeric selection shortcuts, and up to four questions per interaction
- Added: Multi-select answers serialized as JSON array strings so labels containing commas retain unambiguous boundaries while preserving the string-only answer contract
- Enhanced: Tool-call previews now show human-readable arguments for every tool instead of raw JSON, including concise AskUser question summaries and useful path, command, pattern, or scalar previews
- Enhanced: Completed structured tool results are summarized as paths, field/item counts, cancellation states, or concise errors instead of leaking JSON into the TUI
- Fixed: AskUser runtime validation now rejects empty or oversized question lists, and yes/no prompts no longer expose an unsupported `Other` option
- Fixed: Long AskUser previews truncate only the question text while preserving the complete question-count suffix
- Tests: Add coverage for numeric question selection, multi-select JSON serialization, runtime question-list limits, raw-JSON-free tool previews, structured result summaries, and long-question suffix preservation

## 0.6.14

- Added: Gitignore-style `.deepseekignore` enforcement across file access, listings, Grep, Glob, Shell and subagents, with built-in defaults, a non-negotiable `.git`/`.deepseek` safety core, symlink-aware path checks, and explicit blocked-path errors
- Added: Startup setup prompt for materializing `.deepseekignore` defaults, plus global `files.associations` setup for detected VS Code-compatible editors on Linux, macOS and Windows while preserving existing JSONC settings
- Added: Live streaming tool-call status with partial argument previews, per-tool loading messages, and race-safe tool card updates
- Added: Streaming support for Bedrock R1 and Vertex, including the Bedrock AWS event-stream-to-SSE bridge, usage conversion, prompt-based tool-call parsing, and `DEEPSEEK_NO_STREAM=1` fallback to aggregated responses
- Added: Incremental Bedrock R1 markup filtering so `<think>`, `<tool_call>` and related tags never leak to terminal output while thinking remains available through the reasoning callback
- Changed: Clipboard paste handling now centralizes the 60-character/three-line boundary and treats `[Text #n]` placeholders as atomic units during deletion
- Fixed: Grep filtering now preserves colons in filenames, Shell path checks handle quoted paths and command segments, and ignore-file matcher safety rules cannot be negated
- Tests: Add coverage for streaming bridges and markup filtering, live tool status, atomic paste deletion, `.deepseekignore` matching and cache reloads, colon filenames, quoted shell paths, JSONC settings and cross-platform editor settings paths

## 0.6.13

- Added: Expanded lifecycle hooks for session start/end, setup, instruction loading, compaction, permission requests, tool failures and batches, task events, notifications, working-directory changes, worktrees, and MCP elicitation
- Added: Matcher-based hook dispatch with event-specific values, structured hook input metadata, correlation IDs, control decisions, additional context, retries, and permission outcomes
- Added: Hook blocking for permission requests, workflows, worktree operations, and message-history compaction
- Added: Session-end, pre-compaction, and post-compaction integration in the agent lifecycle, plus centralized lifecycle runners for a consistent hook API
- Added: Hook configuration entries and library support for the expanded event set in `/config`
- Changed: Hook settings validation and normalization now preserve matcher groups and distinguish matcher events from direct command events
- Tests: Add Claude Code and Codex lifecycle coverage for event ordering, payloads, matcher dispatch, and manual versus automatic compaction
- Docs: Expand the Introspect hook reference with lifecycle events, matcher values, payloads, and blocking behavior

## 0.6.12

- Fixed: Anchor command and file autocomplete overlays to the input container so clearing a slash command no longer shifts the fullscreen hint or leaves ghost rows in the alternate screen

## 0.6.11

- Added: Native skill loading for built-in and project-defined skills, making valid skill descriptions and instructions available during agent initialization for description-based selection
- Added: `generate-png-images` native skill with local PNG rendering guidance for Pillow, Matplotlib, NumPy, OpenCV, and ImageMagick without requiring an image-generation API key
- Added: Configurable history storage through `DEEPSEEK_HISTORY_PATH`, while preserving the existing default history location
- Changed: Skill and plugin documentation now distinguishes prompt-loaded skills from plugin commands, agents, and hooks that are not yet registered into live runtimes
- Tests: Add coverage for native skill loading, project skill discovery, and isolated history-path cleanup
- Docs: Update the project report with the v0.6.10 release snapshot and comparative architecture analysis

## 0.6.10

- Added: Fullscreen TUI on by default — the session runs in the terminal's alternate screen buffer with the input pinned to the bottom and the transcript scrolling inside a fixed viewport, matching Claude Code's flicker-free renderer
- Added: Environment-aware fullscreen detection — a precedence cascade auto-disables the alternate screen where it is known to break (no TTY, CI, `TERM=dumb`, screen-reader mode, tmux control mode, Windows over SSH) and explains the override in the decision it returns; `DEEPSEEK_FULLSCREEN=1/0` forces either direction
- Added: Scrollbar in the right-hand gutter while fullscreen is active, with half-line resolution (`▀`/`▄`/`█`) so the thumb tracks position to half a row; the column is reserved even with nothing to scroll, since showing and hiding it would re-wrap the transcript and oscillate
- Added: Grab-and-drag the scrollbar thumb, plus click anywhere on the track to jump there — backed by a new pointer-capture path in the vendored Ink (`DOMElement.onPointerDrag` + `findPointerDragTarget`), so a claimed drag bypasses text selection and keeps receiving coordinates past the node's edge
- Added: Transcript scroll keys for fullscreen, where the terminal's own scrollback no longer applies — PageUp/PageDown move half a viewport, the wheel moves three lines, and growth re-pins to the bottom
- Added: One-line hint above the input pointing at `/config`, shown only in fullscreen and only until the first message is sent
- Changed: `interface.alternateScreen` now defaults to on and is labelled "Fullscreen" in `/config`; set it to false to keep native terminal scrollback
- Fixed: Fullscreen state helpers were hardcoded stubs — `isFullscreenActive()` and `isFullscreenEnvEnabled()` always returned false and `isMouseClicksDisabled()` always returned true, leaving the alternate-screen renderer, mouse tracking and text selection inert
- Fixed: Clear a claimed pointer drag on lost-release recovery — releasing outside the window never delivers the SGR release, so the handler stayed armed and hijacked the next drag, scrolling the view while the user tried to select text
- Fixed: Resolve fullscreen once during initialization instead of in the render body, so the tmux control-mode probe no longer spawns a process on every re-render and module state is no longer mutated mid-render
- Fixed: Exclude the scrollbar from text selection so dragging across the transcript neither highlights the gutter nor drops its glyphs into copied text
- Tests: Cover the fullscreen precedence cascade and the scrollbar thumb geometry, including half-line edges, clamping and end-to-end track rendering

## 0.6.9

- Added: Detect and update packages installed via both npm and Bun global installs — checks both package manager directories, updates whichever are found in parallel, and shows the matching install command for each
- Fixed: Silence cssnano postcss-calc warnings on CSS Math Functions during the website build
- Chore: Suppress Node deprecation warnings during the website build

## 0.6.8

- Added: Mirror Claude Code's dynamic workflow monitor — three-level drill-down (run list, phases beside their agents, agent prompt/output), agents pinned to the phase active at spawn, pending phases rendered from parsed meta.phases, and a footer reading "4/4 agents done · 5s · ↓ 226k tokens"
- Fixed: Workflow parser now accepts the JavaScript meta literal the API documents — unquoted keys, single quotes, and trailing commas are evaluated in a sandboxed vm context, while strict JSON keeps working
- Fixed: Keep the monitor stable under long labels and live updates — the initial-run effect fires once per initialRunId, panel cells truncate instead of misaligning borders, and phase/agent columns respect the panel height
- Fixed: Keep workflow identity on state-only agent discovery — the orchestrator subscriber uses the workflow-aware lookup so agents keep their run id and phase; wrapText no longer loops forever on non-positive widths
- Tests: Stop retention tests from spawning 520 processes — seed the audit log and register an in-process handler instead; runtime drops from ~8s to under 1s

## 0.6.7

- Added: Mode and permission summary exposure — `getSystemPrompt()` now returns a safe summary (mode, allowed tools, permission hints) instead of the actual system prompt, with JSDoc explaining the security rationale
- Added: Introspect tool expanded with a comprehensive codebase map, provider guide, settings precedence documentation, and dynamic version from package.json
- Added: Refined Plan mode toolset — lsp and get_goal allowed, git/todo/memory read-only access clarified, subagent and MCP tools restricted
- Added: `edit_file` tracked alongside write_file and patch_file in turn-write metrics and undo snapshot coverage
- Changed: System command description updated to reflect the new permission-focused behavior
- Changed: Tool blocking message now references `/permissions` and mode-appropriate alternatives
- Changed: System prompt rewritten for clarity — autonomous execution, concise communication, and reasoning tag isolation
- Enhanced: WorkflowMonitor with improved workflow state tracking and interaction patterns
- Enhanced: Risk evaluation logic and path safety validation across permission layers
- Tests: Coverage for interaction mode, Introspect tool, risk assessment, plan mode, and WorkflowMonitor interactions

## 0.6.6

- Added: Full mode toggle (Ctrl+O) — expanded thinking (◌), untruncated tool output and shell commands, and a "Full mode · ctrl+o to toggle" footer while active; toggling never interrupts the agent
- Added: Live thinking timer — the thinking block shows "Thinking for N seconds..." counting in real time while the model reasons, then collapses to "Thought for N seconds (ctrl+o to expand)" with the total duration once finished
- Fixed: Live thinking falls back to a generic indicator when no start timestamp is available instead of computing from epoch zero
- Tests: Add rendering coverage for full mode, the live timer, collapsed/expanded thinking blocks, and the verbose footer

## 0.6.5

- Added: Claude Code-style subagent chat — Enter on a subagent row in the activity footer opens its live transcript (@name header, "Message @name" input); messages typed while focused are routed to that subagent via the mailbox
- Added: Progressive token reporting and live reasoning — the footer shows "↓ tokens" growing during a run and the focused view streams the subagent's thinking
- Added: Activity footer renders while focused on a subagent (Enter on main exits focus; v-key keeps the detail view reachable)
- Added: Deterministic loading-spinner messages (rotate on each tool call instead of Math.random)
- Fixed: Reset all subagent callbacks (onMessage/onTokens) on cleanup so detached listeners don't receive later events
- Fixed: Drain coordinator questions on every subagent-loop return path so a message arriving during a final completion is not dropped
- Fixed: Merge consecutive transcript deltas of the same role into one entry; clear subagent focus before slash/! routes to the main agent
- Fixed: Address CodeQL findings — HTML sanitization accepts malformed closing tags and decodes ampersand last; worktree names and emulated tool-call ids use crypto.randomUUID; WebFetch strips script/style with attribute-carrying end tags
- Docs: Improve subagent code documentation with JSDoc comments

## 0.6.4

- Added: Progressive token tracking in the activity footer ("↓ tokens" grows during a subagent run)
- Added: Improved activity display for subagents and workflows
- Docs: Expand the documentation site with new pages and navigation structure

## 0.6.3

- Fixed: Update checks now use an explicit cooldown deadline, so a failed check can retry after ten minutes instead of suppressing notifications for an entire hour.
- Docs: Added a navigable documentation site with separate topic pages and release tracking, making product guidance easier to find than a single long document.
- CI: Added CodeQL analysis with only the workflow permissions it needs and a simpler configuration.
- Docs: Clarified `SECURITY.md` so vulnerability-reporting guidance is easier for contributors to follow.

## 0.6.2

- Docs: Added JSDoc contracts across the agent, orchestration, tools and UI APIs, explaining their public inputs and intended use directly beside the code.
- Enhanced: Subagent creation now receives the already-resolved agent configuration, avoiding a second registry lookup and keeping delegated work aligned with the parent session's configuration.
- Added: Requests for an unregistered agent name now fall back to sequential generic subagents (`Agent1`, `Agent2`, and so on), while configured specialist names continue to resolve normally.

## 0.6.1

- Enhanced: The activity footer has clearer keyboard navigation and detail-mode transitions, making it easier to move between active work and inspect a selected run.
- Added: Connected the activity footer to workflow monitoring and subagent state, so delegated work is represented consistently instead of being detached from its parent activity.
- Docs: Added an architecture and project assessment report covering the system's structure and current implementation.

## 0.6.0

- Enhanced: Workflow discovery, storage, execution and repository settings received stability and safety fixes, with regression coverage for malformed or changing workflow configuration.
- Added: Workflow management commands for discovering and controlling saved workflows, with authorization checks governing their execution.

## 0.5.0

- Added: Introduced the orchestration kernel's persistent store, event bus, thread and task runtimes, workflow engine, and workspace ownership layer as shared foundations for coordinated agent work.
- Refactored: Hardened hook execution and compatibility imports, and simplified kernel hook/workflow runtimes; expanded tests around lifecycle, persistence and workspace boundaries.
- Refactored: Applied the remaining review findings across kernel modules, including event delivery, migrations, task state and workspace path ownership.
- Docs: Reorganized skill guidance and expanded the SDD architecture material to explain how the new orchestration pieces fit together.

## 0.4.15

- Chore: Added a pull-request template with a validation checklist so proposed changes carry consistent review and verification details.
- CI: Restricted checkout workflow permissions and tightened automation security.
- Tests: Extracted reusable Bedrock MCP test helpers and updated coverage for the tool's exported behavior.
- Chore: Release packaging now validates built artifacts and rolls back the release flow when validation fails, preventing a broken package from being published.
- Chore: Rebuilds release artifacts after version changes so the published bundle reflects the version being released.
- CI: Reorganized the CI/CD workflows and testing infrastructure to make build, validation and publication stages more explicit.

## 0.4.14

- Tests: Added regression coverage for terminal behavior and plugin integration, catching breakage in both interactive UI flows and extension loading.

## 0.4.13

- Added: Project-configured MCP servers are opt-in instead of starting implicitly, and the project requires Bun 1.1 or newer for this support.
- Chore: Improved the CRACO development-server configuration with health checks, making local startup failures easier to detect.

## 0.4.12

- Added: Model descriptions make choices easier to distinguish in the selector, while Vim-style navigation adds familiar keyboard movement to the interface.

## 0.4.11

- Added: A configurable maximum continuation count, letting users control how many times the agent may continue a response automatically.
- Style: Replaced the generic package icon with a project-specific SVG and linked provider entries to their documentation.
- Chore: Added QR-code support and upgraded project dependencies needed by the new UI and runtime behavior.

## 0.4.10

- Added: Goals now persist between turns and can continue automatically, allowing multi-step objectives to survive individual response boundaries.

## 0.4.9

- Changed: Session storage is isolated by project and migrated to the new layout, preventing sessions from different workspaces from colliding.
- Enhanced: The website quickstart now uses a responsive layout and decorative SVG artwork so setup guidance remains legible across viewport sizes.

## 0.4.8

- Refactored: Separated tool error handling from tool execution, keeping failure reporting out of each tool's main execution path.

## 0.4.7

- Added: Migration from legacy `.claude` skill directories into `.deepseek`, with duplicate detection to avoid silently overwriting existing skills.
- Changed: Skill discovery now uses the `.deepseek` directory path, matching the project's own configuration namespace.

## 0.4.6

- Enhanced: The landing-page terminal mock now plays its scene with timed animation and streamed output, making the demo feel like a live CLI session rather than a static transcript.

## 0.4.5

- Added: Automatic memory extraction now validates and structures candidate facts before saving them, reducing malformed or unsafe entries in future context.
- Added: The landing page shows npm download activity and provides an install script, giving visitors a direct path from product discovery to installation.
- Added: Introduced the React and Tailwind CSS landing page as the public product entry point.

## 0.4.4

- Added: `/doctor`, `/verify` and `/catalog`, project-guidance loading, a language-server tool, and session export so users can inspect setup, validate work, query the model catalog and carry a session outside the CLI.

## 0.4.3

- Added: External workspace access can now be approved per directory, allowing a task to use a specific trusted path without granting blanket access to every location outside the project.

## 0.4.2

- Added: A feature registry and `/features` command for discovering and controlling experimental capabilities without exposing them as unconditional defaults.
- Enhanced: Micro-compaction now preserves more useful context while trimming redundant conversation content, reducing prompt growth during long sessions.

## 0.4.1

- Added: A visible work divider between tool activity and the assistant's reply, making the transition from execution to response easier to scan.

## 0.4.0

- Added: A side-question flow for asking the agent a brief follow-up while its main task continues; `/btw` replaces the older `/msg` command and routes the answer without cancelling that work.

## 0.3.12

- Refactored: Hardened Vim-mode editing, compaction and terminal rendering so navigation and long-session UI state remain consistent under more input shapes.
- Added: Introduced shared design tokens, word-level diff highlighting and tiered compaction, making visual styling consistent and letting context cleanup preserve more useful detail when possible.

## 0.3.11

- Enhanced: The mobile-authentication QR screen now follows the active theme and has clearer keyboard navigation through its available actions.

## 0.3.10

- Docs: Added a project architecture and status report; refactored worktree handling, border rendering and shared UI components to make those areas easier to maintain.

## 0.3.9

- Added: QR-code generation for mobile authentication so a phone can pair with the local CLI session.
- Fixed: QR generation now reports failures through the application instead of leaving the pairing screen without a useful explanation.

## 0.3.8

- Fixed: The Config menu now wraps and renders text correctly in narrow terminals, keeping labels and values readable instead of clipping or colliding.

## 0.3.7

- Fixed: Returning from a nested settings view now restores the previous focus in narrow layouts, so keyboard navigation does not jump to the wrong row.

## 0.3.6

- Added: Introduced multi-agent session orchestration to coordinate delegated agents and their shared task state within one session.

## 0.3.5

- Added: `/cwd` for inspecting or changing the active working directory and improved session tracking for Git worktrees, keeping each workspace associated with the right conversation.

## 0.3.4

- Added: `/logout` to clear stored credentials and API keys, reset the active provider configuration and return the CLI to its unauthenticated setup state.

## 0.3.3

- Fixed: Frame invalidation now preserves the terminal's alternate-screen history, preventing a redraw from erasing or corrupting the visible session.

## 0.3.2

- Fixed: Corrected the effort-selector track-width calculation so its indicator stays aligned with the available terminal width.
- Tests: Exported a version getter to test update-notifier behavior without depending on package metadata side effects.

## 0.3.1

- Enhanced: Settings panels now adapt their layout and input handling to the terminal dimensions, keeping controls usable as the viewport narrows.

## 0.3.0

- Added: Introduced the settings-management framework and reusable library UIs that later configuration screens can share instead of implementing their own navigation and editing behavior.

## 0.2.17

- Changed: The update notifier now asks before installing instead of silently replacing the global CLI, letting users choose when the new version is applied.

## 0.2.16

- Changed: Plan mode now writes plans through a dedicated `write_plan` tool instead of `write_file`, keeping planning artifacts separate from edits to project files.

## 0.2.15

- Fixed: The Enchant prompt-refinement preference is initialized from saved settings and persisted when changed, so the user's choice remains consistent across CLI launches.

## 0.2.14

- Added: The Plan-mode approval flow: the agent can present a proposed approach for review and waits for approval before carrying out the planned work.
- Docs: Corrected the Bedrock comment text so its explanation matches the behavior it describes.

## 0.2.13

- Changed: Consolidated configuration entry points into `/config`, giving users one place to inspect and update settings instead of separate settings flows.

## 0.2.12

- Added: Context-usage breakdowns and Git-worktree awareness, so users can see what consumes the model context and sessions can follow the workspace they are operating in.
- Chore: Updated the built-in CEO agent's configured model to GPT 5.5.

## 0.2.11

- Chore: Updated the built-in reviewer agent's model configuration to `gpt-5.6-luna`.

## 0.2.10

- Fixed: Corrected the footer-height calculation so terminal content reserves the right number of rows; clarified the component breakdown to make future layout changes safer.

## 0.2.9

- Changed: Removed the `/enchant` alias and made Escape abort the active operation, reducing command ambiguity and providing a direct cancellation key.
- Tests: Updated `/model` and `/models` parsing coverage to reflect their distinct command behavior.
- Chore: Upgraded AWS SDK, React and test dependencies to keep provider integrations and the terminal UI on supported versions.

## 0.2.8

- Added: Consolidated model selection and introduced an interactive effort selector, so users can change the active model and reasoning depth through the terminal UI.

## 0.2.7

- Fixed: Isolated subagent memory by task and corrected loop concurrency, preventing parallel delegates from overwriting or reading one another's state.
- Added: Fixed coder, reviewer and tester specialists with asynchronous communication, giving delegated work clearer roles and a way to report progress.
- Changed: The CEO agent's Git guidance now requires explicit permission for repository changes.
- Tests: Expanded valid timeout and iteration-limit ranges and updated their boundary tests.
- Chore: Increased timeout and iteration ceilings to accommodate longer delegated tasks.

## 0.2.6

- Added: A configurable agent color in the input chrome, making the active agent easier to distinguish at a glance.
- Added: `edit_file` for targeted line-level modifications, avoiding whole-file rewrites when a small surgical change is enough.

## 0.2.4

- Fixed: Hardened plugin discovery and lifecycle handling so malformed or changing plugin state is less likely to break the CLI.
- Added: Plugin install, list, remove and update commands, allowing users to manage extensions from the CLI.

## 0.2.3

- Fixed: Multiline input history now restores and navigates wrapped entries consistently, keeping the cursor on the expected visual line when terminal width changes.

## 0.2.2

- Chore: Added the local settings file to `.gitignore`, preventing machine-specific configuration from being accidentally committed.

## 0.2.1

- Added: A skill registry and installer command so users can discover and install reusable agent skills through the CLI.
- Added: JSON output mode for scripted use and a permissions UI for inspecting and managing tool access.
- Chore: Removed the `THINKING.md` file from the project tree.

## 0.2.0

- Fixed: The input now stays at the bottom of the terminal by measuring content height dynamically, rather than relying on a fixed layout that drifted as the transcript grew.

## 0.1.16

- Chore: Removed unused subsystems, dependencies and imports that were no longer part of the active CLI, reducing maintenance overhead and avoiding shipping dead code.

## 0.1.15

- Fixed: Replaced the single pasted-block state with indexed pasted-text entries, keeping multiple paste payloads separate while the prompt is edited.
- Added: Bracketed-paste support with visible text placeholders, so large terminal pastes remain addressable as one input unit.
- Fixed: Improved role-prefix stripping and tool-call parsing so provider-formatted responses are less likely to leak control text into the conversation.
- Refactored: Removed the obsolete proxy and OAuth modules and simplified provider setup around the supported direct API flows.
- Chore: Removed the OAuth-specific system prompt that was no longer used after the provider architecture change.

## 0.1.14

- Chore: Simplified the release script to a minimal publish flow, making the steps performed during a version release easier to follow.

## 0.1.13

- Fixed: Unknown models now default to a conservative 128K context limit instead of assuming a larger window the provider may not support.
- Added: Updated the DeepSeek model catalog for V4 and its one-million-token context windows, keeping model selection and context accounting aligned with the provider.

## 0.1.12

- Added: A command to turn Enchant prompt refinement on or off without editing configuration files.
- Docs: Translated architecture decision records and reorganized the proxy documentation so contributors can follow the design in English.
- Chore: Removed the obsolete `.reversa` configuration directory from the project.

## 0.1.11

- Chore: Removed private Claude agent directories and refreshed the public demo so the repository presents the shipped DeepSeek Code product.
- Chore: Translated retained agent definitions and removed project-specific skills and task files that were not part of the public distribution.
- Chore: Removed `CLAUDE.md` from the public repository to avoid publishing machine- or workflow-specific instructions.
- Docs: Added `CONTRIBUTING.md` with guidance for outside contributors.
- Docs: Rewrote the README for the public release, covering installation and the project's user-facing capabilities.

## 0.1.10

- Chore: Version bumps now always rebuild the package instead of relying on skip logic, preventing a release from reusing stale generated artifacts.
- Chore: Updated package attribution and added an npm-authentication check before publishing, so release failures are caught before the publish step.

## 0.1.9

- Added: Configurable risk rules for tool actions, allowing permission decisions to account for the operation being requested.
- Enhanced: Approval requests now include the relevant action context, so consent applies to the specific risky operation rather than a vague, reusable permission.

## 0.1.8

- Fixed: Memory synchronization now handles extraction results that are not promises, avoiding runtime errors when a sync implementation returns synchronously.
- Added: An automatic memory-sync step after turns, allowing durable context to be extracted without a separate manual command.
- Chore: Added a build after version changes so published artifacts contain the bumped package metadata.

## 0.1.7

- Fixed: A failed package-manager update no longer interrupts the current CLI session; the failure is handled and the user can continue working.

## 0.1.6

- Fixed: Resolved review findings across the provider and agent paths, including safer AWS credential handling and more reliable Bedrock configuration.
- Fixed: Bedrock now uses environment-based credentials only when both required AWS credentials are present, avoiding partially configured authentication.
- Fixed: Corrected credential resolution and refreshed inference-profile identifiers so supported AWS models can be selected and called reliably.
- Changed: Removed the `medium` effort level because the DeepSeek API maps it to `high`, avoiding a choice that did not produce a distinct provider setting.
- Added: Reusable agent protocols and a skills library, plus the initial Claude-compatible workspace configuration.
- Enhanced: Release preparation now detects untracked files more accurately and reports warnings for the phase that introduced them.

## 0.1.5

- Added: Prompt refinement to improve the wording sent to the model before an agent turn begins.
- Fixed: Prompt-refiner tests now disable the feature after agent initialization, preventing test setup from changing the behavior being measured.
- Fixed: Isolated session-parent tests from `mock.module` state so one test's provider mocks cannot contaminate another.
- Tests: Import session-parent functions directly in focused tests, reducing reliance on broad module mocks.
- Chore: Expanded the release script with explicit options, safety checks and clearer error handling before versioning or publishing.

## 0.1.4

- Added: An effort-command hint and clarified related type names, making the available reasoning-depth control easier to discover.
- Added: A browser-page observer that detects when a DeepSeek response has stopped streaming, plus history formatting and input buffering for the browser proxy's tool-aware conversation flow.
- Chore: Moved public-facing assets into the external public directory used by the project layout.

## 0.1.3

- Changed: Automatic updates install silently in the background; the new CLI version is picked up on the next launch instead of interrupting the current session with an install prompt.
- Changed: Global updates use npm directly rather than trying to infer which package manager installed the CLI.
- Fixed: Update failures are kept out of the active TUI flow, allowing the current session to continue when an update cannot be installed.

## 0.1.2

- Added: Subagent roles are inferred from the task, with role-specific tool permissions so delegated work receives only the tools appropriate to its role
- Added: Subagents retain results from earlier tasks as session memory to provide context for later delegations; that memory resets at the start of each user turn
- Added: Structured subagent results include confidence and metadata; verification can be requested explicitly or triggered for low-confidence file changes and review findings
- Enhanced: Subagent prompts include role descriptions and relevant memory; the TUI shows role and verification status
- Tests: Cover subagent result contracts, memory, permissions, verification and UI status

## 0.1.1

- Added: Agent turns stop after 100 tool-use iterations to prevent an infinite loop, with a notice in the conversation when the limit is reached
- Added: Context can be compacted during a turn when usage crosses its threshold, rather than waiting for the turn to finish
- Added: `/effort` controls reasoning depth with `low`, `medium`, `high` and `max` levels; the selected level adjusts the agent prompt and provider thinking parameters, with `low` disabling thinking and `max` enabling extended reasoning
- Fixed: Rejected tool calls remain consistent in the API conversation; parallel subagents keep the provider and model selected when they started
- Enhanced: WebFetch preserves error context, Bedrock tool-call IDs use UUIDs, and the status bar and theme receive visual refinements

## 0.1.0

- Added: Introduced the agentic tool-use loop and its initial terminal interface, providing the core runtime for asking the model to inspect and change a project.
- Added: Integrated Model Context Protocol (MCP) tools and added theme selection with clearer message rendering in the UI.
- Added: Diff-based file updates so project edits can be applied and reviewed as targeted changes instead of opaque full-file replacements.
- Added: Made project documentation introspectable by the agent and attached the current timestamp to user messages for time-aware work.
