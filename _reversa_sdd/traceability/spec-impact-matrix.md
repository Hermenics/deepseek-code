# Spec impact matrix

Legend: **H** high direct impact, **M** medium integration impact, **L** low/observational impact, — no normal direct dependency.

| Change in ↓ / impacts → | Agent | Tools/Auth | Orchestration | TUI/Ink | Settings | Extensions | Session/Memory | Providers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Agent loop | — | H | H | M | M | M | H | H |
| Tools / authorization | H | — | M | M | H | M | L | L |
| Orchestration | H | M | — | H | M | L | M | M |
| TUI / Ink | M | L | H | — | M | L | M | — |
| Settings | H | H | M | M | — | H | H | H |
| Plugins, skills, MCP, LSP | M | M | L | M | H | — | L | L |
| Session, goal, memory | H | L | M | M | H | L | — | L |
| Provider adapter | H | L | M | L | H | L | L | — |

## Change-routing rules

| Proposed change | Inspect together |
| --- | --- |
| New tool or mutation capability | tools, interaction modes, safe paths, risk, permissions, hooks, audit, subagent profiles |
| Provider/tool protocol change | agent loop, provider adapter, context limits, streaming tests, model catalog/settings |
| New delegated workflow | orchestration lifecycle/schemas, worktree policy, task UI, persistence/recovery |
| New executable project integration | user-scope settings restriction, child process environment, path/risk enforcement, docs |
| UI command or approval surface | command parser, App state, interaction mode, renderer behavior, accessibility/keyboard tests |

The matrix is derived from imports and control flow, not a claim that every cell changes for every implementation. 🟡
