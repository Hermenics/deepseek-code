# Tools

## Overview

The tool layer is the sole controlled adapter between the agent and workspace, processes, web, delegation, Git, plans, goals, and memory. 🟢

## Responsibilities

- Expose typed schemas for the current tool registry. 🟢
- Resolve paths canonically, block sensitive/escaped locations, and write atomically. 🟢
- Bound shell, web, LSP, subagent, and external access through their guards. 🟢

## Functional requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| TO-RF-01 | File mutation must pass workspace and sensitive-path checks. 🟢 | Must |
| TO-RF-02 | Web fetch must block private/metadata SSRF targets and bound redirects/response size. 🟢 | Must |
| TO-RF-03 | Delegation must use constrained roles/profiles and structured result submission. 🟢 | Must |
| TO-RF-04 | Goal/plan/memory tools must use their domain invariants. 🟢 | Must |

## Acceptance criteria

```gherkin
Given a write path resolving outside the workspace without approval
When a file tool is called
Then no file is written and the call returns a denial

Given a public allowed URL
When web_fetch completes within its bounds
Then cleaned text is returned without private-network access
```

## Traceability

`src/tools/`, especially `file/`, `WebFetch/`, `SubAgent/`, `Lsp/`, `Shell/`. 🟢
