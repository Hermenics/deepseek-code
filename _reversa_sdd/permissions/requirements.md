# Permissions Module — Requirements

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Overview

The Permissions module handles tool access control through glob-based rules and risk assessment. It determines whether a tool invocation should be allowed, denied, or requires user confirmation.

## Functional Requirements

### FR-01: Permission Rule Resolution 🟢
- **Must** parse rules in format `ToolName(pattern)` or `ToolName` (no pattern)
- **Must** evaluate deny rules before allow rules
- **Must** return `allow`, `deny`, or `ask` decision
- **Must** default to `allow` when no rules defined

### FR-02: Glob Pattern Matching 🟢
- **Must** support `*` wildcard (match any characters)
- **Must** support `?` wildcard (match single character)
- **Must** use iterative matching algorithm (anti-ReDoS)
- **Must** reject patterns with > 10 wildcards (safety limit)
- **Must** be case-insensitive

### FR-03: Risk Assessment 🟢
- **Must** evaluate 46 default risk rules
- **Must** support user-defined rules (override by id, or append with new id)
- **Must** classify as `high` (always confirm) or `medium` (confirm in subagent only)
- **Must** support pattern-based rules and condition-based rules
- **Must** sort rules by specificity (longer pattern first)

### FR-04: Conditions 🟢
- **Must** support `large_overwrite` condition (file >= 100 lines)
- **Must** support `multi_edit_burst` condition (>= 3 writes this turn)

## Non-Functional Requirements

### NFR-01: Security 🟢
- Iterative glob matching prevents ReDoS
- Wildcard limit prevents pathological patterns
- Content-scoped session approval prevents over-broad access
