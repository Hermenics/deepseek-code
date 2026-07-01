# ADR-006: Interaction Modes — Plan/Build/Auto

> Status: ACCEPTED  
> Date: 2026 (commit `54c652d`)  
> Confidence: 🟢 CONFIRMED

## Context

The original system had an "auto-accept" mode that skipped permission prompts. Users needed clearer mental models for:
- Read-only exploration (safe)
- Normal development (default with safety gates)
- Full autonomy (dangerous but powerful)

## Decision

Implement three named interaction modes with clear semantics:
- **Plan** (yellow): read-only tools only — safe exploration
- **Build** (green): default — write tools with risk-based safety gates
- **Auto** (red): zero restrictions — all tools, no prompts

Cycling via Shift+Tab. Model can activate Plan and Build programmatically, but **never** Auto.

## Rationale

1. Clear color-coded mental model (traffic light: green=normal, yellow=caution, red=danger)
2. Plan mode enables safe "thinking out loud" without accidental writes
3. Auto mode enables power users to skip friction for trusted tasks
4. Preventing model self-escalation to Auto is a critical safety invariant

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Binary toggle (safe/unsafe) | Too coarse — users want read-only exploration too |
| Per-tool toggles | Too granular, cognitive overload |
| Permission prompts only (no modes) | Prompt fatigue — users click "yes" habitually, losing security value |
| 4+ modes (add "review" mode) | Diminishing returns, complexity not justified |

## Consequences

- **Positive:** Users know exactly what the agent can do at a glance (status bar color)
- **Positive:** Plan mode = zero risk of accidental writes during exploration
- **Positive:** Auto mode = maximum productivity for trusted contexts
- **Negative:** Mode state is per-session only, resets on restart (user must re-select)
- **Safety invariant:** `canModelActivateMode('auto') === false` prevents model self-escalation
