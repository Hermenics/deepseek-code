# Services Module — Requirements

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Overview

The Services module contains the context compaction service — the logic for automatically summarizing conversations when context usage grows too high.

## Functional Requirements

### FR-01: Auto-Compact Detection 🟢
- **Must** evaluate `shouldAutoCompact()` using contextUsage/contextLimit ratio
- **Must** trigger at configurable threshold (default 0.85)
- **Must** respect `autoCompact: false` setting to disable
- **Must** track consecutive failures for backoff

### FR-02: Micro-Compact 🟢
- **Must** clear old tool result contents (keep structure, clear body)
- **Must** preserve the last 5 tool results (MICRO_COMPACT_KEEP_LAST)
- **Must** not touch messages after the last boundary marker

### FR-03: Full Compact (LLM Summarization) 🟢
- **Must** use a structured 9-section summary prompt
- **Must** call the LLM to generate the summary
- **Must** insert a boundary marker after summarization
- **Must** preserve messages after the boundary verbatim

### FR-04: Summary Prompt 🟢
- **Must** instruct the LLM to preserve: primary request, technical concepts, file paths, errors, problem-solving state, user messages, pending tasks, current work, next steps

## Non-Functional Requirements

### NFR-01: Reliability 🟢
- Failed compaction tracked (consecutiveFailures)
- Never loses messages after boundary
- 13,000 token buffer reserved for compact decision
