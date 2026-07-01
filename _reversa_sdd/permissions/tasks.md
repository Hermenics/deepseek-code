# Permissions Module — Tasks

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Tasks for Reimplementation

### T-01: Implement Permission Types
- **Source:** `src/permissions/types.ts`
- **Description:** Define PermissionRule, PermissionDecision, RiskLevel, RiskRule, RiskConfig, RiskContext, RiskAssessment.
- **Done when:** All types exported and usable by other modules.
- **Confidence:** 🟢

### T-02: Implement Glob Matcher
- **Source:** `src/permissions/matcher.ts:18-52`
- **Description:** Iterative glob matching with wildcard limit (10), case-insensitive, O(n) worst-case.
- **Done when:** Matches correctly, rejects > 10 wildcards, no backtracking.
- **Confidence:** 🟢

### T-03: Implement Permission Resolution
- **Source:** `src/permissions/matcher.ts:89-116`
- **Description:** Parse deny/allow rules, evaluate in order (deny first), return decision.
- **Done when:** Deny-first semantics correct, fallback logic handles all cases.
- **Confidence:** 🟢

### T-04: Implement Risk Assessment
- **Source:** `src/permissions/risk.ts`
- **Description:** 46 default rules, merge with user rules, sort by specificity, evaluate patterns and conditions.
- **Done when:** All default rules fire correctly, user overrides work, conditions evaluated.
- **Confidence:** 🟢
