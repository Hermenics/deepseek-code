# Permissions Module — Design

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Architecture

Three focused files: types, glob matcher, and risk assessor.

## Structure

```
permissions/
├── index.ts      — re-exports
├── types.ts      — PermissionRule, RiskRule, RiskConfig, RiskAssessment, etc.
├── matcher.ts    — parseRule(), globMatch(), resolvePermission()
└── risk.ts       — DEFAULT_RISK_RULES (46), assessRisk()
```

## Key Algorithms

### Iterative Glob Matching (O(n) worst-case, no backtracking)
```
pi = 0, si = 0, starPi = -1, starSi = -1
while si < str.length:
  if pattern[pi] == str[si] or pattern[pi] == '?':
    pi++, si++
  else if pattern[pi] == '*':
    starPi = pi, starSi = si, pi++
  else if starPi != -1:
    pi = starPi + 1, starSi++, si = starSi
  else:
    return false
skip trailing stars
return pi == pattern.length
```

### Risk Assessment Algorithm
```
1. If risk.enabled === false: return null
2. Merge default rules with user rules (by id)
3. Sort by pattern length (descending) then level (high first)
4. Get tool content (command for shell, path for file tools)
5. For each rule:
   - Skip if rule.tool doesn't match
   - If pattern: globMatch(pattern, content)
   - If condition: evaluate (large_overwrite, multi_edit_burst)
   - If matched: return assessment with requiresConfirmation
6. No match: return null
```

### Permission Resolution Algorithm
```
1. No permissions defined → allow
2. Deny rules first: if any match → deny
3. Allow rules: if any match → allow
4. Allow rules exist but none match → ask
5. Only deny rules exist, none match → allow
```
