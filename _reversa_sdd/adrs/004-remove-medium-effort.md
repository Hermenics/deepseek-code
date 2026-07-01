# ADR-004: Remove Medium Effort Level

> Status: ACCEPTED  
> Date: 2026 (commit `00b4747`)  
> Confidence: 🟢 CONFIRMED

## Context

The effort level system originally had 4 levels: `low`, `medium`, `high`, `max`. These map to DeepSeek API's reasoning depth parameter.

## Decision

Remove `medium` effort level. Keep only 3 levels: `low`, `high`, `max`.

## Rationale

The DeepSeek API internally maps both `low` and `medium` to `high` — making `medium` a placebo that gives users a false sense of granularity. Simplifying to 3 real levels reduces confusion.

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Keep medium as alias for high | Confusing — users expect different behavior from different names |
| Map medium to a different API param | No API param exists that would produce distinct behavior |
| Remove low too | Low still has value as "fast, no deep reasoning" for simple queries |

## Consequences

- **Positive:** Honest mapping — each level produces distinct API behavior
- **Positive:** Simpler UI (3 options instead of 4)
- **Negative:** Breaking change for users who configured `medium` in settings
- **Migration:** 7 files changed, trivial diff (~9 insertions, ~11 deletions)
