# Agent Module — Tasks

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Tasks for Reimplementation

### T-01: Implement Agent Class Core
- **Source:** `src/agent/agent.ts:140-300`
- **Description:** Create the Agent class with constructor, provider initialization, OpenAI SDK client creation, tool registry setup, and ready promise pattern.
- **Done when:** Agent instantiates with a ProviderConfig, creates correct SDK client, loads tools into Map, sets context limit per model.
- **Confidence:** 🟢

### T-02: Implement Initialization Pipeline
- **Source:** `src/agent/agent.ts:248-296`
- **Description:** Parallel load of steering, DEEPSEEK.md, settings, and MCP tools. Merge into system prompt. Apply settings overrides. Run SessionStart hooks.
- **Done when:** All 4 resources load in parallel, system prompt assembled correctly, graceful degradation on failure.
- **Confidence:** 🟢

### T-03: Implement run() Entry Point
- **Source:** `src/agent/agent.ts:300-450`
- **Description:** Await readyPromise, reset turn state, apply prompt refinement, push user message, invoke runLoop.
- **Done when:** User message processed, refinement applied when configured, runLoop invoked with callbacks.
- **Confidence:** 🟢

### T-04: Implement runLoop — Streaming Path
- **Source:** `src/agent/agent.ts:711-960`
- **Description:** Main loop with 100-iteration cap. Stream LLM response, accumulate tokens and tool calls from deltas, handle reasoning_content, fire callbacks.
- **Done when:** Streaming works with token-by-token callbacks, tool calls accumulated correctly, iteration limit enforced.
- **Confidence:** 🟢

### T-05: Implement runLoop — Non-Streaming Path
- **Source:** `src/agent/agent.ts:726-800`
- **Description:** Batch request for Bedrock R1 and Vertex. Parse response, extract tool calls (XML for Bedrock R1, native for V3.x), handle reasoning_content.
- **Done when:** Both Bedrock R1 (prompt-based) and V3.x (native) tool calling work correctly.
- **Confidence:** 🟢

### T-06: Implement checkAndExecuteTool — Full Pipeline
- **Source:** `src/agent/agent.ts:1022-1130`
- **Description:** 5-layer permission pipeline: auto-mode bypass, mode check, risk assessment (Build), permission rules (Plan), hooks, execute, audit.
- **Done when:** Each layer correctly gates execution, DenyAbortError thrown on deny, content-scoped approvals tracked.
- **Confidence:** 🟢

### T-07: Implement Parallel Tool Execution
- **Source:** `src/agent/agent.ts:988-1017`
- **Description:** Partition tool calls into parallel-safe vs sequential. Execute parallel via Promise.allSettled. Handle DenyAbortError from any parallel call.
- **Done when:** PARALLEL_SAFE tools run concurrently, write tools run sequentially, denied calls get placeholder results.
- **Confidence:** 🟢

### T-08: Implement Auto-Compact Integration
- **Source:** `src/agent/agent.ts` (compact check after tool results)
- **Description:** After each tool execution batch, check shouldAutoCompact(). Run micro-compact then full compact if needed. Insert boundary markers.
- **Done when:** Compaction triggers at 85%, micro-compact preserves last 5 results, full compact summarizes via LLM call.
- **Confidence:** 🟢

### T-09: Implement Abort Mechanism
- **Source:** `src/agent/agent.ts:298-310`
- **Description:** AbortController created per iteration. abort() method sets signal. Stream handler checks signal. Graceful cleanup on abort.
- **Done when:** Ctrl+C stops streaming mid-token, no message corruption, onDone fires.
- **Confidence:** 🟢

### T-10: Implement Memory Sync
- **Source:** `src/agent/agent.ts` (syncTurn method)
- **Description:** After each completed turn, sync memory. Guard against non-thenable returns.
- **Done when:** Memory persisted after turns, errors silently caught.
- **Confidence:** 🟢

### T-11: Implement History & Checkpoint Persistence
- **Source:** `src/agent/history.ts`, `src/agent/checkpoint.ts`, `src/agent/fileCheckpoint.ts`
- **Description:** Save full conversation to disk. Support session checkpoints (save/restore, max 20). File checkpoints before writes (max 10, FIFO eviction).
- **Done when:** History file written after each turn, checkpoints saveable/restorable, file undo works.
- **Confidence:** 🟢

### T-12: Implement Bedrock Tool Prompt Builder
- **Source:** `src/agent/agent.ts:58-68`
- **Description:** For Bedrock R1 (no native tool calling), inject XML tool definitions into system prompt. Parse `<tool_call>` responses.
- **Done when:** Tool definitions rendered as XML, tool calls parsed from response, results fed back as `<tool_result>`.
- **Confidence:** 🟢
