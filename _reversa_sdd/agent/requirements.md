# Agent

## Overview

The Agent converts a terminal request into a bounded provider/tool loop while preserving workspace safety, session context, memory, goals, and callbacks. 🟢

## Responsibilities

- Initialize settings, steering, extensions, memory, provider, and hooks before accepting work. 🟢
- Stream model output, validate tool calls, and return tool results to the transcript. 🟢
- Maintain context limits, compaction, sessions, goals, and provider-specific behavior. 🟢

## Functional requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| AG-RF-01 | The agent must reject/return tool errors instead of executing malformed calls. 🟢 | Must |
| AG-RF-02 | A turn must stop after 100 loop iterations, cancellation, or terminal provider failure. 🟢 | Must |
| AG-RF-03 | It must compact context before limits and stop automatic compaction after repeated failure. 🟢 | Must |
| AG-RF-04 | It should refine eligible non-command prompts above configured length. 🟢 | Should |

## Non-functional requirements

| Type | Requirement | Evidence | Confidence |
| --- | --- | --- | --- |
| Reliability | Retry rate-limited/service-unavailable calls with bounded backoff. | `src/agent/agent.ts` | 🟢 |
| Security | Redact audit/exported sensitive values and treat memory as untrusted. | `auditLog.ts`, `memory.ts` | 🟢 |
| Performance | Do not load unapproved MCP; compact near configured threshold. | `agent.ts` | 🟢 |

## Acceptance criteria

```gherkin
Given an initialized agent and a valid read tool call
When the model requests the tool
Then the result is appended to model context and the turn may continue

Given a malformed or unauthorized tool call
When it is requested
Then no implementation runs and the model receives an error result
```

## Traceability

`src/agent/agent.ts`, `session.ts`, `goal.ts`, `memory.ts`, `mcp.ts`, `providers/`. 🟢
