# DeepSeek Code — Current Inventory

> Re-extracted on 2026-08-01 from source at `v0.4.15`.
> Confidence: 🟢 **CONFIRMED** unless marked otherwise.

## Product

DeepSeek Code is a Bun-based terminal coding agent. Its interactive client is built with React 19 and an in-repository Ink-compatible renderer; its non-interactive `--pipe` mode streams a single agent run through stdin/stdout.

## Repository surface

| Area | Files | Purpose |
|---|---:|---|
| `src/` | 358 TypeScript/TSX | CLI, agent runtime, tools, TUI, renderer, orchestration, and integrations |
| `tests/` | 103 test files | Bun test coverage for core, TUI, MCP, orchestration, permissions, sessions, tools, plugins, and skills |
| `website/` | 16 JS/JSX files | Separate React marketing site |
| `examples/` | 2 source/example files | Example agents and multi-agent orchestration |
| `.github/workflows/ci.yml` | 1 workflow | CI for CLI and website |

The tracked project surface contains 512 files after excluding generated, dependency, Git, and Reversa folders. The CLI source contains 45,771 TypeScript/TSX lines.

## Runtime and entry points

| Entry point | Role |
|---|---|
| `src/index.tsx` | Bun shebang entry point; delegates to the interactive CLI |
| `src/entrypoints/cli.tsx` | Parses CLI flags, executes one-shot commands, initializes the React/Ink application |
| `src/entrypoints/pipe.ts` | Headless stdin/stdout execution with optional JSON result |
| `build.ts` | Produces `dist/cli.mjs` and the executable `dist/deepseek` wrapper |

The CLI supports `deepseek`, an initial prompt, `agent <name>`, `--resume`, `--pipe`, `--json`, `doctor`, `update`, `logout`, `help`, and `version` paths. The packaged binary is `deepseek`.

## Source modules

| Module | Role |
|---|---|
| `agent` | Core loop, providers, MCP, memory, goals, sessions, worktrees, planning, steering, verification, and context management |
| `orchestration` | Persistent multi-agent task tree, mailbox, runtime slots, review and workspace isolation |
| `tools` | Model-callable tools, including files, shell, Git, web, LSP, goals, subagents, plans, MCP-related introspection and memory |
| `commands` | Slash-command handlers for runtime capabilities and configuration |
| `ui` | Application TUI, setup flows, input, messages, plan, side questions, QR and subagent presentation |
| `ink` | In-repository React terminal renderer and terminal/event/layout primitives |
| `plugins` | Plugin discovery, validation, install, registry, variables and command integration |
| `skills` | Skill discovery, validation, installation and slash-command parsing |
| `settings` | Hierarchical settings loading, repository scope and persistence |
| `permissions` | Allow/deny matching, risk classification and human-readable explanations |
| `hooks` | Configurable command hooks and tool-permission integration |
| `services` | Compaction and post-compaction cleanup |
| `entrypoints` | Interactive and pipe-mode startup |
| `utils` | Credentials, filesystem, terminal, environment, logging and update helpers |
| `constants` | Product, agent, tool and UI constants |
| `types` | Shared provider and permission contracts |
| `bootstrap` | Initial application state |
| `native-ts` | TypeScript port/wrapper of Yoga layout support |

`src/catalog.ts`, `src/doctor.ts`, `src/lsp.ts`, `src/features.ts`, `src/commands.ts`, and `src/constants.ts` are root-level cross-cutting modules.

## Test and delivery surface

Bun's built-in test runner executes the 103 test files. CI uses Bun 1.3.13, installs with `bun install --frozen-lockfile`, then type-checks, tests with coverage, builds, and smoke-checks the published package. The website runs separately with Node 24, `npm ci`, lint, tests, and build. GitHub Actions permissions are restricted to read-only repository contents.

## Persistence and external systems

There is no relational database schema, migration, or ORM. Local persistence consists of configuration, sessions, task/orchestration state, skills, plugins, credentials, and logs stored in user/project filesystem locations. External integrations include the OpenAI-compatible DeepSeek API, AWS Bedrock, Google Vertex authentication, Model Context Protocol servers, LSP processes, Git, shell commands, HTTP fetches, and npm registry access for updates.
