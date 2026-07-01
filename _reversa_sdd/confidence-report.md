# Detective — Confidence Report

> Generated at: 2026-07-01

## Summary

The Detective phase extracted domain knowledge, state machines, permission matrices, and 10 Architecture Decision Records from the DeepSeek Code codebase.

## Artifacts Generated

| Artifact | Confidence | Notes |
|----------|:----------:|-------|
| `domain.md` | 🟢 | 27 glossary terms, 23 rules, 7 invariants — all from source code |
| `state-machines.md` | 🟢 | 8 state machines covering all major lifecycle flows |
| `permissions.md` | 🟢 | Complete matrices for modes, roles, risk rules, path sandbox |
| `adrs/001-bun-as-runtime.md` | 🟢 | Confirmed from project structure and CI issues |
| `adrs/002-fork-ink.md` | 🟢 | Confirmed from commit `8b59345` and `src/ink/` presence |
| `adrs/003-remove-oauth.md` | 🟢 | Confirmed from commit `e09a92b` and git history |
| `adrs/004-remove-medium-effort.md` | 🟢 | Confirmed from commit `00b4747` with explicit rationale |
| `adrs/005-hooks-user-only.md` | 🟢 | Confirmed from settings loader code |
| `adrs/006-interaction-modes.md` | 🟢 | Confirmed from commit `54c652d` and `interactionMode.ts` |
| `adrs/007-risk-content-scoped.md` | 🟢 | Confirmed from commits `9640812`, `8f5f789` |
| `adrs/008-subagent-roles.md` | 🟢 | Confirmed from commit `b022cab` and `permissions.ts` |
| `adrs/009-path-sandbox.md` | 🟢 | Confirmed from `pathSafety.ts` |
| `adrs/010-remove-language-selection.md` | 🟢 | Confirmed from commit `400b4fb` |

## Gaps Identified

| ID | Description | Severity | Recommendation |
|----|-------------|----------|----------------|
| GAP-01 | TOCTOU window in path sandbox symlink check | 🟡 Low | Document as known limitation; real exploit requires precise timing |
| GAP-02 | No user override for blocked directories | 🟡 Low | Users cannot read `.env` even when legitimate; consider allowlist |
| GAP-03 | SubAgent role inference relies on keywords | 🟡 Medium | Misclassification possible; "read and fix" → executor |
| GAP-04 | Memory cap (2000 chars) is very small | 🟡 Low | May limit usefulness for complex projects |
| GAP-05 | No explicit rate limiting on tool calls per turn | 🟡 Low | Only indirect limit via 100-iteration cap |
| GAP-06 | Proxy module has no dedicated test coverage visible | 🟡 Medium | Browser-based provider path less tested |

## Rules Discovered: 23
## ADRs Generated: 10
## State Machines Documented: 8
## Gaps Identified: 6 (all 🟡, none critical)
