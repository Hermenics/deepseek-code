# Changelog

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

- Fixed: Make update notifier cooldown deadline-based — failures now retry after 10 minutes instead of silencing update checks for an hour
- Docs: Add comprehensive documentation site with release tracking and multi-page navigation
- CI: Add CodeQL workflow with minimal permissions and simplified configuration
- Docs: Revise SECURITY.md for clarity

## 0.6.2

- Docs: Add comprehensive JSDoc comments to public APIs
- Added: Pass resolved agent config to subagent spawning to avoid duplicate registry lookups
- Added: Enhance agent loading and generic subagent naming

## 0.6.1

- Added: Improve activity footer keyboard navigation and detail mode handling
- Added: Integrate activity footer and workflow monitoring with enhanced subagent tracking
- Docs: Create comprehensive project report with architecture and assessment

## 0.6.0

- Added: Enhance runtime stability, safety, and configuration
- Added: Workflow management system with CLI commands and authorization

## 0.5.0

- Refactored: Strengthen hook executor safety and expand test coverage
- Refactored: Address CodeRabbit PR #12 findings across kernel modules
- Added: Orchestration kernel with store, events, threads, and workspace management
- Docs: Reorganize skill documentation and expand SDD architecture

## 0.4.15

- Chore: Add pull request template with validation checklist
- CI: Enhance workflow security and restrict checkout permissions
- Tests: Refactor Bedrock MCP tool test and export helper
- Chore: Improve artifact validation and add rollback on build failure
- Chore: Add artifact rebuild step before publishing
- Chore: Reorganize CI/CD pipeline and modernize testing infrastructure

## 0.4.14

- Tests: Add terminal and plugin regression coverage

## 0.4.13

- Added: Make project MCP servers opt-in and require Bun 1.1+
- Chore: Enhance craco configuration with health check and dev server improvements

## 0.4.12

- Added: Model descriptions and vim-style navigation

## 0.4.11

- Added: Configurable max continuations setting
- Style: Replace lucide Package icon with custom SVG and add provider documentation links
- Chore: Add QR code support and upgrade dependencies

## 0.4.10

- Added: Persistent goal management system with continuations

## 0.4.9

- Added: Restructure session storage with project isolation and migration support
- Added: Enhance quickstart section with decorative SVG and responsive labels

## 0.4.8

- Refactored: Separate tool error handling from execution logic

## 0.4.7

- Added: Legacy .claude directory migration and duplicate detection
- Chore: Update skills directory path from .claude to .deepseek

## 0.4.6

- Added: Enhance terminal mock with animated scene playback and streaming effects

## 0.4.5

- Added: Safety validation and structured auto-memory extraction
- Added: Enhance landing page with npm downloads display and install script
- Added: Landing page with React and Tailwind CSS

## 0.4.4

- Added: Diagnostic tools, project guidance, LSP integration, and session export

## 0.4.3

- Added: Granular directory-level approval system for external paths

## 0.4.2

- Added: Experimental features system and enhanced micro-compaction

## 0.4.1

- Added: Work divider to separate tool execution from replies

## 0.4.0

- Added: Side-question system and replace msg command

## 0.3.12

- Refactored: Improve vim mode, compaction, and UI robustness
- Added: Design system, enhanced vim mode, word-level diffs, and tiered compaction

## 0.3.11

- Added: Enhance QR code UI with theme support and improved navigation

## 0.3.10

- Docs: Add comprehensive project report and refactor worktree, border rendering, and UI

## 0.3.9

- Added: Error handling to QR code generation
- Added: QR code generation for mobile authentication

## 0.3.8

- Fixed: Improve text rendering and wrapping behavior in ConfigMenu narrow layout

## 0.3.7

- Fixed: Restore focus state when navigating back in narrow layout

## 0.3.6

- Added: Multi-agent session orchestration system

## 0.3.5

- Added: Cwd command and improve worktree session tracking

## 0.3.4

- Added: Logout command and handler

## 0.3.3

- Fixed: Handle alternate screen buffer history on frame invalidation

## 0.3.2

- Style: Adjust effort selector track width calculation
- Tests: Improve testability with version getter export

## 0.3.1

- Added: Improve settings layout responsiveness and input handling

## 0.3.0

- Added: Comprehensive settings management and library UIs

## 0.2.17

- Added: Replace silent auto-update with interactive update prompt

## 0.2.16

- Added: Replace write_file with dedicated write_plan tool in plan mode

## 0.2.15

- Added: Enchant preference persistence and initialization

## 0.2.14

- Added: Plan mode interaction with approval workflow
- Fixed: Correct comment grammar and clarity

## 0.2.13

- Added: Consolidate settings into unified config command

## 0.2.12

- Added: Context breakdown tracking and worktree support
- Chore: Update CEO model to Claude Opus 4.6

## 0.2.11

- Chore: Update reviewer model to gpt-5.6-luna

## 0.2.10

- Fixed: Correct footer height calculation and clarify component breakdown

## 0.2.9

- Added: Remove enchant alias and add abort on escape key
- Tests: Update /model and /models command parsing expectations
- Chore: Upgrade AWS SDK, React, and testing dependencies

## 0.2.8

- Added: Consolidate model selection and add interactive effort selector

## 0.2.7

- Added: Fix concurrency and memory isolation in subagent loops
- Docs: Update CEO agent git operation requirements with explicit permission rule
- Added: 3 fixed specialist agents (coder, reviewer, tester) with async communication
- Tests: Update timeout and iteration limit validation ranges
- Chore: Increase timeout and iteration limits

## 0.2.6

- Added: Customizable agent color to input chrome
- Added: Edit_file tool for surgical line-level edits

## 0.2.4

- Fixed: Harden plugin system reliability and correctness
- Added: Plugin management system with install, list, remove, and update commands

## 0.2.3

- Fixed: Improve multiline input history navigation and text wrapping

## 0.2.2

- Chore: Add local settings file to gitignore

## 0.2.1

- Added: Installer command and registry for skill management
- Added: JSON output mode and permissions UI
- Chore: Remove THINKING.md file

## 0.2.0

- Added: Push input to bottom by calculating dynamic content height

## 0.1.16

- Chore: Remove dead code — unused subsystems, deps and imports

## 0.1.15

- Fixed: Replace pastedBlock state with indexed pastedTexts array
- Added: Support for bracketed paste with text placeholders
- Fixed: Improve role prefix stripping and tool call parsing
- Chore: Remove oauth system prompt file
- Refactored: Remove proxy and oauth modules, simplify provider architecture

## 0.1.14

- Chore: Simplify release script to minimal implementation

## 0.1.13

- Fixed: Reduce default context limit to 128K for unknown models
- Added: Update DeepSeek models to V4 with 1M context windows

## 0.1.12

- Added: Enchant-prompt command to toggle prompt refinement
- Docs: Translate ADRs and architecture docs to English, reorganize proxy module
- Chore: Remove .reversa configuration directory

## 0.1.11

- Chore: Clean up Claude agent directories and update demo
- Chore: Translate .claude agents to English, remove skills and task files
- Chore: Remove CLAUDE.md from public repo
- Docs: Add CONTRIBUTING.md for open-source contributors
- Docs: Rewrite README for open-source release

## 0.1.10

- Chore: Remove build skip logic and always rebuild on version bump
- Chore: Update attribution and add npm auth verification

## 0.1.9

- Added: Enhance risk assessment with content-scoped approvals
- Added: Risk assessment system with configurable rules

## 0.1.8

- Fixed: Guard memory sync against non-thenable return values
- Added: Auto-learning memory sync after each turn
- Chore: Add build step after version bump

## 0.1.7

- Fixed: Handle failed package manager update gracefully

## 0.1.6

- Fixed: Address CodeRabbit review findings
- Fixed: Require both AWS credentials before using fromEnv()
- Added: Fix credential resolution and update inference profile IDs
- Refactored: Remove medium level — DeepSeek API maps it to high
- Chore: Add agent protocols, skills library, and claude workspace config
- Chore: Refactor untracked file detection and add phase-aware warnings

## 0.1.5

- Tests: Disable prompt refiner after agent initialization
- Added: Prompt refinement to optimize user messages
- Fixed: Isolate sessionParent tests from mock.module contamination
- Tests: Import session parent functions directly
- Chore: Expand release script with options, safety checks, and improved error handling

## 0.1.4

- Added: Effort command hint and improve type naming
- Added: Browser observer, history formatting, and input handling
- Chore: Update public directory path to external subdirectory

## 0.1.0

- Added: Integrate Model Context Protocol (MCP) support and enhance UI components with theme selection and improved message rendering.
- Added: Diff-based file updates and enhance system documentation with introspectable project docs
- Added: Prepend current timestamp to user messages in agent loop
- Added: Agentic tool-use framework with UI and core system capabilities
