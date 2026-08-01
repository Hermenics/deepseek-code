# Services

## Overview

The current service layer provides layered context compaction for long agent conversations. 🟢

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| SV-RF-01 | Micro-compaction may reduce old large tool results while retaining recent context. 🟢 | Must |
| SV-RF-02 | Full compaction must produce a structured summary when threshold is reached. 🟢 | Must |
| SV-RF-03 | Repeated compaction failure must stop automatic retry. 🟢 | Must |

## Acceptance criteria

```gherkin
Given a context beyond the configured threshold
When automatic compaction succeeds
Then the agent continues with a structured bounded context

Given repeated compaction failures
When the breaker threshold is reached
Then automatic compaction stops rather than looping
```

## Traceability

`src/services/compact/`, `src/agent/agent.ts`. 🟢
