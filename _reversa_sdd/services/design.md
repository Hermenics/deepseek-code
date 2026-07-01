# Services Module — Design

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Architecture

A focused module for context compaction with two strategies: micro-compact (cheap) and full compact (LLM-based).

## Structure

```
services/
└── compact/
    ├── index.ts          — re-exports
    ├── autoCompact.ts    — shouldAutoCompact(), microCompact(), config/state types
    └── summaryPrompt.ts  — COMPACT_SUMMARY_PROMPT, COMPACT_SYSTEM_PROMPT
```

## Key Types

```typescript
interface AutoCompactConfig {
  enabled: boolean     // default true
  threshold: number    // default 0.85
}

interface CompactState {
  consecutiveFailures: number
  lastCompactTimestamp: number
}
```

## Compaction Strategy

```
1. shouldAutoCompact(contextUsage, contextLimit, config, state)?
   - enabled && (contextUsage / contextLimit >= threshold)
   - Not within cooldown (lastCompactTimestamp)

2. First try: microCompact(messages)
   - Walk messages backwards
   - For tool messages older than last 5: replace content with "[compacted]"
   - Check if freed enough tokens

3. If still above threshold: full compact
   - Send conversation to LLM with COMPACT_SUMMARY_PROMPT
   - Replace pre-boundary messages with summary
   - Insert new boundary marker
   - Update lastCompactTimestamp

4. On failure: increment consecutiveFailures
```

## Summary Prompt (9 sections)

The LLM is asked to preserve:
1. Primary request and intent
2. Key technical concepts
3. Files and code sections referenced
4. Errors encountered and fixes applied
5. Problem-solving approach and state
6. All user messages (verbatim if short)
7. Pending tasks
8. Current work in progress
9. Optional next step
