# Tools — technical design

## Interface

`allTools` registers 23 typed tools for filesystem, search, shell, web, LSP, delegation, Git, memory, plans, and goals. Every tool has validated parameters and a result payload. 🟢

## Main flow

1. Agent selects registered tool and validates arguments. 🟢
2. File tools run canonical path safety and lease/atomic mutation. 🟢
3. The tool adapter executes within time, size, and role bounds. 🟢
4. Agent applies post-tool hooks/audit and returns result to model. 🟢

## Key boundaries

`web_fetch` pins DNS/IP decisions and enforces host/TLS/redirect checks. LSP and MCP are user-authorized process integrations. Subagents cannot recursively bypass their profile allowlist. 🟢

## Dependencies

Permissions/risk, hooks, settings, orchestration, workspace filesystem, Git and provider transcript. 🟢
