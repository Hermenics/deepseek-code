# Changelog

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
