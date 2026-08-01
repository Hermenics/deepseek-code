# Settings

## Overview

Settings combine defaults, legacy values, user scope, project scope, and local scope while preserving explicit authority boundaries. 🟢

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| SE-RF-01 | Merge scopes predictably and report validation/origin diagnostics. 🟢 | Must |
| SE-RF-02 | Project/local settings must not activate hooks, LSP commands, MCP, or default auto mode. 🟢 | Must |
| SE-RF-03 | Secret-like values must not be persisted through settings write paths. 🟢 | Must |
| SE-RF-04 | Persist valid settings atomically with restrictive permissions. 🟢 | Must |

## Acceptance criteria

```gherkin
Given a project settings file enabling hooks
When effective settings load
Then the executable hook is ignored and a scope warning is available

Given a valid user-scope MCP opt-in
When the agent restarts
Then project MCP definitions become eligible to load
```

## Traceability

`src/settings/repository.ts`, `types.ts`. 🟢
