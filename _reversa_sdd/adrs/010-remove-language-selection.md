# ADR-010: Language Selection Removed

> Status: ACCEPTED  
> Date: 2026 (commit `400b4fb`)  
> Confidence: 🟢 CONFIRMED

## Context

The setup wizard originally included a language selection screen. This allowed users to configure the UI language for DeepSeek Code.

## Decision

Remove the language selection feature entirely. The UI is English-only.

## Rationale

1. DeepSeek models handle multilingual prompts natively — the user can write in any language and get responses in that language
2. UI strings in a CLI are minimal (labels, status bar) — not worth the i18n infrastructure
3. Simplifies the setup flow (one less screen)
4. Reduces state management complexity

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Keep language selection for UI chrome | Maintenance burden exceeds value for a CLI tool |
| Auto-detect from system locale | Adds complexity, edge cases with locale fallbacks |
| i18n library (i18next, etc.) | Overkill for a developer CLI with ~20 UI strings |

## Consequences

- **Positive:** Simpler setup flow, less code, less state
- **Positive:** No stale translations to maintain
- **Negative:** Non-English speakers see English UI labels (but model responses remain in their language)
