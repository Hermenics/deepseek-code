# Constants

## Overview

Constants define stable operational defaults, provider/model metadata, rendering tokens, limits, and shared command values. 🟢

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| CO-RF-01 | Shared limits/defaults must have one source to avoid divergent behavior. 🟢 | Must |
| CO-RF-02 | Provider/model metadata must expose supported capabilities to UI/agent selection. 🟢 | Must |
| CO-RF-03 | Constants must remain validated by consumers at trust boundaries. 🟡 | Must |

## Acceptance criteria

```gherkin
Given a configured value exceeds its allowed range
When a consumer validates it
Then the configured value is bounded or rejected using the canonical limit

Given a model catalog entry
When UI/provider selection uses it
Then capability metadata is available consistently
```

## Traceability

`src/constants/`, `src/types/provider.ts`, settings/agent consumers. 🟢
