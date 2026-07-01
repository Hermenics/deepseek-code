# Hooks Module — Tasks

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Tasks for Reimplementation

### T-01: Implement Hook Command Executor
- **Source:** `src/hooks/executor.ts:9-44`
- **Description:** Spawn shell process, send JSON to stdin, capture stdout, handle timeout and errors.
- **Done when:** Hooks execute with correct input, timeout fires, errors handled gracefully.
- **Confidence:** 🟢

### T-02: Implement PreToolUse Hook Pipeline
- **Source:** `src/hooks/executor.ts:51-93`
- **Description:** Match hooks by pattern, chain execution, handle block/approve/modify decisions.
- **Done when:** Blocking stops execution, modified input propagates, unmatched returns pass.
- **Confidence:** 🟢

### T-03: Implement PostToolUse Hooks
- **Source:** `src/hooks/executor.ts:98-121`
- **Description:** Fire-and-forget after tool execution. Cap result at 10k chars.
- **Done when:** Hooks fire without blocking, errors swallowed.
- **Confidence:** 🟢

### T-04: Implement Hook Matcher
- **Source:** `src/hooks/matcher.ts`
- **Description:** Match tool name against pattern: exact match, `*` (all), or pipe-separated list.
- **Done when:** All pattern formats match correctly.
- **Confidence:** 🟢
