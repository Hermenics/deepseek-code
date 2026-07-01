# Settings Module — Requirements

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Overview

The Settings module loads, merges, and provides configuration from three levels: user, project, and local.

## Functional Requirements

### FR-01: Three-Level Loading 🟢
- **Must** load from `~/.deepseek/settings.json` (user level)
- **Must** load from `.deepseek/settings.json` (project level)
- **Must** load from `.deepseek/settings.local.json` (local level)
- **Must** handle missing files gracefully (empty config)

### FR-02: Security Stripping 🟢
- **Must** strip `hooks` field from project-level settings
- **Must** strip `hooks` field from local-level settings
- **Must** preserve hooks only from user-level settings

### FR-03: Merge Algorithm 🟢
- **Must** merge levels in priority order: user (low) → project (med) → local (high)
- **Must** concatenate + deduplicate arrays
- **Must** deep merge objects one level
- **Must** override scalars with higher-priority value

### FR-04: Settings Interface 🟢
- **Must** support: permissions, hooks, model, theme, autoCompact, autoCompactThreshold, promptRefiner, risk
- **Must** be extensible (unknown keys preserved)

## Non-Functional Requirements

### NFR-01: Security 🟢
- Hook isolation prevents repository-based command injection
