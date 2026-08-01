# Permissions

## Overview

Permissions resolve local tool authority from interaction mode, path safety, risk rules, configured allow/deny/ask rules, hooks, and operator confirmation. 🟢

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| PE-RF-01 | Deny rules must win before allow/ask matching. 🟢 | Must |
| PE-RF-02 | High-risk operations must require confirmation even with low-risk auto-approval. 🟢 | Must |
| PE-RF-03 | Permission glob complexity must remain bounded. 🟢 | Must |
| PE-RF-04 | External directories need explicit approval and sensitive paths remain blocked. 🟢 | Must |

## Acceptance criteria

```gherkin
Given overlapping allow and deny rules
When both match a tool request
Then the deny decision wins

Given a destructive high-risk request
When auto-approve-low-risk is enabled
Then the request still requires a confirmation
```

## Traceability

`src/permissions/`, `src/tools/file/pathSafety.ts`, `src/agent/agent.ts`. 🟢
