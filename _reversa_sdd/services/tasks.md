# Services Module — Tasks

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Tasks for Reimplementation

### T-01: Implement shouldAutoCompact()
- **Source:** `src/services/compact/autoCompact.ts`
- **Description:** Check if ratio exceeds threshold, respect enabled flag and cooldown.
- **Done when:** Returns true at 85%+ usage, respects disabled setting.
- **Confidence:** 🟢

### T-02: Implement microCompact()
- **Source:** `src/services/compact/autoCompact.ts`
- **Description:** Clear old tool result bodies, keep last 5, respect boundary markers.
- **Done when:** Old results cleared, recent preserved, boundary honored.
- **Confidence:** 🟢

### T-03: Implement Full Compact (Summary Prompt)
- **Source:** `src/services/compact/summaryPrompt.ts`
- **Description:** Define 9-section summary prompt and system prompt for the compaction LLM call.
- **Done when:** Prompt covers all 9 sections, system prompt is concise.
- **Confidence:** 🟢

### T-04: Integrate Compaction in Agent Loop
- **Source:** `src/agent/agent.ts` (compact check points)
- **Description:** After tool execution, check shouldAutoCompact. Run micro then full if needed. Insert boundary. Update state.
- **Done when:** Compaction triggers correctly mid-loop, conversation continues.
- **Confidence:** 🟢
