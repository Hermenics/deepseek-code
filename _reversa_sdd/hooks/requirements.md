# Hooks

## Overview

Hooks let a user-scoped configuration inspect, block, or adjust lifecycle/tool activity through bounded shell children. 🟢

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| HO-RF-01 | Hooks must be ignored outside user scope. 🟢 | Must |
| HO-RF-02 | Pre-tool hooks may block or modify input; post hooks observe bounded results. 🟢 | Must |
| HO-RF-03 | Each child uses JSON stdin and a bounded default timeout. 🟢 | Must |

## Acceptance criteria

```gherkin
Given a pre-tool hook returns a blocking response
When a tool request reaches hooks
Then the tool is not executed

Given a project-scope hook configuration
When settings load
Then it does not execute
```

## Traceability

`src/hooks/`, `src/settings/repository.ts`. 🟢
