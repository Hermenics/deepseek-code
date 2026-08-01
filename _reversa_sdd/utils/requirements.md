# Utilities

## Overview

Utilities centralize credentials, configuration migration, filesystem, terminal, logging, formatting, and update-notification support used across the CLI. 🟢

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| UT-RF-01 | Credential/config helpers must not expose secret values in diagnostics. 🟢 | Must |
| UT-RF-02 | File and terminal helpers must provide consistent local behavior to callers. 🟢 | Must |
| UT-RF-03 | Update checks must be independently testable. 🟡 | Should |

## Acceptance criteria

```gherkin
Given a diagnostic/export path containing a credential
When it is formatted for output
Then the secret is redacted

Given a supported legacy configuration
When migration runs
Then current consumers receive the normalized value
```

## Traceability

`src/utils/`, `src/agent/credentials.ts`. 🟢
