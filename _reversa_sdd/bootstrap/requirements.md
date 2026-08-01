# Bootstrap

## Overview

Bootstrap gathers startup state and compatibility setup required before interactive behavior begins. 🟢

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| BO-RF-01 | Startup must resolve local environment/configuration prerequisites before normal execution. 🟡 | Must |
| BO-RF-02 | Compatibility/setup behavior must not silently elevate project authority. 🟢 | Must |

## Acceptance criteria

```gherkin
Given a first-run environment without configured credentials
When startup reaches bootstrap
Then the CLI routes to setup rather than an unusable agent session

Given project-provided executable configuration
When bootstrap resolves settings
Then user-scope restrictions still apply
```

## Traceability

`src/bootstrap/`, `src/entrypoints/cli.tsx`, settings and credential flows. 🟡
