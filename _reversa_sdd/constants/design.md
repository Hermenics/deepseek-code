# Constants Module — Design

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Architecture

Constants are split across 4 files by domain, re-exported from a single index.

## Structure

```
constants/
├── index.ts      — re-exports all
├── agent.ts      — UNDO_STACK_MAX, CONTEXT_COMPACT_THRESHOLD, etc.
├── tools.ts      — SHELL_OUTPUT_MAX_CHARS, SHELL_TIMEOUT_MS, etc.
├── product.ts    — PRODUCT_NAME, PRODUCT_CLI_NAME, CONFIG_DIR
└── ui.ts         — DIFF_MAX_LINES
```

## Design Rationale

- Grouped by consumer domain (not alphabetically)
- All exported as named `const` (tree-shakeable)
- No computed values — all literal primitives
- Root `src/constants.ts` re-exports for backward compatibility
