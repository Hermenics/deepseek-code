# Project Inventory — deepseek-code

> Confidence: 🟢 CONFIRMED — extracted directly from the filesystem.

**Generated at:** 2026-07-01  
**Version:** 0.1.11  
**Package:** `@hermenics/deepseek-code`  
**License:** Apache-2.0

## Overview

AI-powered coding assistant that lives in your terminal. A CLI/TUI application built with Bun, React 19, and a forked Ink renderer. Supports multiple LLM providers (DeepSeek API, AWS Bedrock, Google Vertex, local via proxy).

## File Statistics

| Metric | Count |
|--------|-------|
| Total project files (excluding deps/git) | 950 |
| TypeScript/TSX files | 393 |
| Lines of code (src/) | 38,076 |
| Test files | 69 |
| React component files | 56 |

## Directory Structure

```
src/
├── agent/              # Core agent loop, LLM client, providers, session, memory
│   └── providers/      # Bedrock, Vertex, OAuth, Proxy (DeepSeek API relay)
│       └── proxy/      # Full HTTP proxy server (Hono-based)
│           ├── browser/      # Playwright browser pool
│           ├── formatters/   # Anthropic/OpenAI format adapters
│           ├── middleware/   # Auth, CORS, rate-limit, error-handler
│           ├── routes/       # Anthropic & OpenAI-compatible endpoints
│           ├── services/     # DeepSeek API, orchestrator, cache, history
│           ├── tools/        # Tool schema, registry, prompt emulation
│           └── types/        # Proxy type definitions
├── bootstrap/          # App initialization state
├── commands/           # Slash commands (22 commands)
├── constants/          # App-wide constants
├── context/            # React context (AppContext)
├── entrypoints/        # CLI and pipe entry points
├── hooks/              # Pre/post tool hooks system
├── ink/                # Forked Ink renderer (terminal React)
│   ├── components/     # Box, Text, Button, ScrollBox, Link, etc.
│   ├── events/         # Event system (keyboard, click, focus, paste)
│   ├── hooks/          # Terminal hooks (input, stdin, viewport, focus)
│   ├── layout/         # Layout engine (geometry, yoga)
│   └── termio/         # Terminal I/O (ANSI, CSI, SGR, ESC, OSC)
├── native-ts/          # Yoga layout bindings (pure TS)
├── permissions/        # Permission system (risk assessment, matching)
├── public/             # Static assets
├── screens/            # Top-level screens (REPL, Setup)
├── services/           # MCP client, session management, auto-compact
├── settings/           # Settings loader/writer
├── state/              # Global state store (selectors)
├── stubs/              # Dev stubs (react-devtools-core)
├── tools/              # Agent tools (15 tools)
├── types/              # Shared type definitions
├── ui/                 # Application UI layer
│   ├── input/          # InputBox, cursor, ghost text, hooks, render
│   ├── layout/         # StatusBar, WelcomeScreen
│   ├── messages/       # MessageList, DiffView, MarkdownText, TodoPanel
│   ├── setup/          # ApiKey, Theme, Model, Language setup screens
│   └── subagent/       # SubagentList, SubagentLine, color manager
└── utils/              # Utilities (fs, credentials, env, log, debug)
tests/                  # Vitest test suite
packages/
├── relay-server/       # Relay server sub-package (deps only)
└── remote-shared/      # Shared remote utilities (deps only)
external/               # External documentation/overview
```

## Modules Identified (13)

| Module | Path | Responsibility |
|--------|------|---------------|
| agent | `src/agent/` | Core agent loop, LLM communication, session, memory, cost tracking |
| proxy | `src/agent/providers/proxy/` | HTTP proxy server translating API formats to DeepSeek |
| tools | `src/tools/` | File, shell, git, glob, grep, memory, subagent, web tools |
| commands | `src/commands/` | CLI slash commands (model, theme, help, undo, etc.) |
| ink | `src/ink/` | Forked Ink terminal React renderer |
| ui | `src/ui/` | Application UI components and screens |
| hooks | `src/hooks/` | Pre/post tool execution hooks |
| permissions | `src/permissions/` | Permission rules, risk assessment, glob matching |
| settings | `src/settings/` | Settings loader/writer/types |
| state | `src/state/` | Global state store and selectors |
| services | `src/services/` | MCP client, session management, compaction |
| constants | `src/constants/` | Application-wide constants |
| utils | `src/utils/` | Shared utilities |

## Entry Points

| File | Type |
|------|------|
| `src/index.tsx` | App entry (main) |
| `src/entrypoints/cli.tsx` | CLI entrypoint |
| `src/entrypoints/pipe.ts` | Pipe/stdin entrypoint |
| `build.ts` | Build script |

## CI/CD

- `.github/workflows/ci.yml` — Bun-based CI: typecheck + test on push/PR to main

## Database / Persistence

No traditional database. Persistence is JSON-file based:
- Session files
- Settings JSON
- Memory/knowledge files
- Audit log
- Todo store

## Test Coverage

| Framework | Files | Pattern |
|-----------|-------|---------|
| Vitest | 69 | `tests/**/*.test.ts`, `tests/**/*.test.tsx` |

Test areas: agent, tools, UI components, hooks, proxy, permissions, streaming, subagents, MCP, providers.
