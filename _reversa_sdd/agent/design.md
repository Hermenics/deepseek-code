# Agent — technical design

## Interfaces

| Symbol | Contract |
| --- | --- |
| `Agent` | Initializes local context and executes a bounded `run` loop. |
| `run(input, callbacks)` | Streams provider events and authorized tool results through callbacks. |
| `Goal` | Objective, lifecycle status, usage, continuation and blocker counters. |

## Main flow

1. `initialize()` concurrently loads steering, merged settings, user-approved MCP, memory, and session hooks. 🟢
2. `run()` prepares prompt/context, optionally refines input, then enters model/tool loop. 🟢
3. Each call is schema-validated and delegated to authorization/execution. 🟢
4. Final content, tool results, usage, and session state flow to callbacks/storage. 🟢

## Alternatives and failures

Bedrock R1 uses XML-like prompt tool encoding where native chat tools are unavailable. Provider retry is bounded (1/2/4 seconds); compaction failure is circuit-broken. 🟢

## Dependencies

Settings, permissions, hooks, compaction, all tools, orchestration session, and provider adapters. 🟢
