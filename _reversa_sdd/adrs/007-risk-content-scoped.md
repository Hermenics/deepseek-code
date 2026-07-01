# ADR-007: Risk Assessment with Content-Scoped Approvals

> Status: ACCEPTED  
> Date: 2026 (commits `9640812`, `8f5f789`)  
> Confidence: 🟢 CONFIRMED

## Context

Build mode needed safety gates that were:
- Configurable (users can add/override rules)
- Specific (not blanket tool-level approvals)
- Contextual (subagents are less trusted than the main agent)

Initial implementation used rule-level session approval ("once you approve `shell:rm`, all rm commands pass"). This was too permissive.

## Decision

Implement a two-tier risk system with **content-scoped approvals**:
1. Rules match by tool + glob pattern or condition
2. High risk: always confirm
3. Medium risk: confirm only in subagent context
4. Session approval is scoped to `rule_id + actual_content` (e.g., `risk:shell:rm:rm -rf ./tmp`)

## Rationale

Content scoping prevents a single "yes" on `rm -rf ./tmp` from silently approving `rm -rf /`. Each unique command/path requires its own approval.

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Rule-level approval (approve the rule itself) | Too broad — approving "shell:rm" passes all rm commands |
| Tool-level approval (approve "shell" entirely) | Dangerously broad, defeats the purpose |
| Never remember approvals (always ask) | Prompt fatigue, especially in iterative dev loops |
| Time-based expiry | Complex, and session boundary is natural enough |

## Consequences

- **Positive:** Granular safety without prompt fatigue
- **Positive:** Subagents get extra scrutiny (medium → confirm)
- **Positive:** Rules are configurable and mergeable via settings
- **Negative:** Session key can get long for complex commands
- **Negative:** User must approve similar but not identical commands separately (e.g., `rm -rf ./tmp` and `rm -rf ./dist` are different approvals)
