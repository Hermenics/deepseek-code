# Shared types

## Overview

Shared types express provider configuration, theme names, and cross-module contracts used to keep the CLI compile-time coherent. 🟢

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| TY-RF-01 | Provider configuration must represent supported provider-specific inputs. 🟢 | Must |
| TY-RF-02 | Shared unions must constrain UI/settings/agent values consistently. 🟢 | Must |

## Acceptance criteria

```gherkin
Given an unsupported provider configuration shape
When TypeScript validation or boundary validation runs
Then consumers cannot treat it as a supported provider config

Given a theme/mode/provider selection
When passed between modules
Then it uses the shared union contract
```

## Traceability

`src/types/`, `src/settings/types.ts`, provider/UI consumers. 🟢
