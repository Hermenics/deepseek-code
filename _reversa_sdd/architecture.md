# Architecture Overview

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## System Summary

DeepSeek Code is an AI-powered coding assistant that runs as a CLI/TUI application. It connects to multiple LLM providers, manages a conversation loop with tool calling, and renders a rich terminal interface.

**Key architectural characteristics:**
- **Monolithic single-process** — all components run in one Bun process
- **Event-driven** — React reconciler for UI, streaming callbacks for LLM
- **Plugin-extensible** — MCP servers, hooks, named agents, slash commands
- **Security-layered** — mode gates → risk rules → permission rules → hooks → path sandbox

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         DeepSeek Code                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────────┐  ┌─────────────────────────┐   │
│  │  CLI     │→ │  TUI Layer   │  │  Command Router (26 cmds)│   │
│  │Entrypoint│  │  (React+Ink) │  └─────────────────────────┘   │
│  └──────────┘  └──────┬───────┘                                  │
│                        │ user message                             │
│                        ▼                                         │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    Agent Core                            │    │
│  │  ┌─────────┐  ┌──────────┐  ┌────────────────────┐     │    │
│  │  │ runLoop │→ │ Provider │→ │ LLM (stream/batch) │     │    │
│  │  │ (≤100)  │  │  Layer   │  └────────────────────┘     │    │
│  │  └────┬────┘  └──────────┘                              │    │
│  │       │ tool_calls                                       │    │
│  │       ▼                                                  │    │
│  │  ┌──────────────────────────────────────────────────┐   │    │
│  │  │         Tool Execution Pipeline                   │   │    │
│  │  │  Mode → Risk → Permissions → Hooks → Execute     │   │    │
│  │  └──────────────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                        │                                         │
│  ┌─────────┐  ┌───────┴──────┐  ┌──────────────┐               │
│  │ Memory  │  │ Tool Registry │  │ Compaction   │               │
│  │ Store   │  │ (15 + MCP)   │  │ Service      │               │
│  └─────────┘  └──────────────┘  └──────────────┘               │
├─────────────────────────────────────────────────────────────────┤
│  Settings │ File Checkpoints │ Audit Log │ History │ Remote Ctrl │
└─────────────────────────────────────────────────────────────────┘
         │              │             │            │
         ▼              ▼             ▼            ▼
   ┌──────────┐  ┌──────────┐  ┌─────────┐  ┌─────────┐
   │Filesystem│  │ LLM APIs │  │MCP Srvrs│  │WS Relay │
   └──────────┘  └──────────┘  └─────────┘  └─────────┘
```

## Architectural Decisions Summary

| # | Decision | Rationale |
|---|----------|-----------|
| ADR-001 | Bun as runtime | Native TS, fast startup, built-in test/build |
| ADR-002 | Fork Ink renderer | Full control over terminal rendering |
| ADR-003 | Remove OAuth | API keys available, OAuth was fragile |
| ADR-004 | Remove medium effort | DeepSeek API treats medium=high (placebo) |
| ADR-005 | Hooks only from user settings | Prevents supply-chain attacks via repo |
| ADR-006 | Three interaction modes | Clear mental model with safety semantics |
| ADR-007 | Content-scoped risk approvals | Granular without blanket "yes to all" |
| ADR-008 | SubAgent role-based permissions | Least privilege for delegated tasks |
| ADR-009 | Path sandbox with symlink protection | Defense-in-depth for file access |
| ADR-010 | Remove language selection | LLM handles multilingual natively |

## Quality Attributes

| Attribute | How Addressed |
|-----------|--------------|
| **Security** | 5-layer permission pipeline, path sandbox, SSRF protection, hook isolation |
| **Responsiveness** | Streaming tokens, parallel tool execution, Bun fast startup |
| **Extensibility** | MCP protocol, named agents, slash commands, hooks |
| **Reliability** | 100-iteration cap, auto-compact, graceful abort, file checkpoints for undo |
| **Usability** | 3 clear modes (traffic light colors), ghost suggestions, vim mode, 6 themes |

## Technical Debt

| ID | Area | Description | Severity |
|----|------|-------------|----------|
| TD-01 | Ink fork | TODOs referencing upstream Ink issues (e.g., `TODO(vadimdemedes)`) | Low |
| TD-02 | Proxy module | Limited test coverage for browser-based provider path | Medium |
| TD-03 | Memory cap | 2000 chars is restrictive for long-running projects | Low |
| TD-04 | Agent class size | 1259 lines — could benefit from further extraction | Low |
| TD-05 | Blocked dirs hardcoded | No user override for path sandbox blocked directories | Low |

## Integrations

| External System | Protocol | Direction | Purpose |
|----------------|----------|-----------|---------|
| DeepSeek API | HTTPS (OpenAI format) | Outbound | Primary LLM inference |
| AWS Bedrock | AWS SDK | Outbound | Cloud LLM (DeepSeek R1, V3.x) |
| Google Vertex AI | GCP SDK | Outbound | Cloud LLM |
| Ollama / LM Studio | HTTP (OpenAI-compatible) | Outbound | Local LLM inference |
| DeepSeek Browser | Playwright + Hono | Outbound | Browser-based API access |
| MCP Servers | MCP (stdio/SSE) | Bidirectional | External tool discovery + execution |
| WebSocket Relay | WS + E2E encryption | Bidirectional | Remote control from mobile |
| Local Filesystem | POSIX fs | Bidirectional | Project file read/write/exec |
| External Web | HTTPS (fetch) | Outbound | URL content retrieval |
