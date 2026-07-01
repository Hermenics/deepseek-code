# ADR-005: Hooks Only From User-Level Settings

> Status: ACCEPTED  
> Date: 2026 (commit `f9bfa10`)  
> Confidence: 🟢 CONFIRMED

## Context

The settings system loads configuration from three levels:
1. User: `~/.deepseek/settings.json`
2. Project: `.deepseek/settings.json` (committed to repo)
3. Local: `.deepseek/settings.local.json` (gitignored)

Hooks are shell commands that execute before/after tool use and at session start.

## Decision

**Strip hooks from project-level and local-level settings before merging.** Only user-level settings can define hooks.

## Rationale

A cloned repository could contain a malicious `.deepseek/settings.json` with hooks that execute arbitrary shell commands the moment a user opens the project with DeepSeek Code. This is a supply-chain attack vector.

The user-level settings file (`~/.deepseek/settings.json`) is controlled by the machine owner and is never committed to any repository.

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Allow project hooks with a prompt | Users click through prompts; one wrong "yes" = arbitrary code execution |
| Require hooks to be in a whitelist | Complex to maintain, still risky for new entries |
| Sandbox hook execution | Shell sandboxing is unreliable across platforms (Linux, macOS, Windows) |
| Disable hooks entirely | Loses legitimate automation use cases (linting, formatting, notifications) |

## Consequences

- **Positive:** Eliminates supply-chain attack via repository-committed hooks
- **Positive:** Simple implementation — `stripHooks()` before merge
- **Negative:** Teams cannot share hook configurations via project settings; each developer must configure their own
- **Workaround:** Teams can document recommended hooks in README/CONTRIBUTING for developers to add to their user settings
