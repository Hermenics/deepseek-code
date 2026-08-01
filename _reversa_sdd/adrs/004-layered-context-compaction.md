# ADR 004 — Compact context in layers

**Status:** accepted. **Evidence:** `src/services/compact/`, commits `f5548a1`, `957fa08`. **Confidence:** 🟢

## Decision

Use enhanced micro-compaction for older large tool results and a structured full summary when context approaches its configured threshold.

## Alternatives considered

- Let the provider reject oversized transcripts.
- Drop arbitrary old messages without a summary.

## Consequences

- Long sessions preserve more task-relevant context within provider limits.
- Summarization is fallible, so repeated failures trip a circuit breaker rather than creating an endless recovery loop.

