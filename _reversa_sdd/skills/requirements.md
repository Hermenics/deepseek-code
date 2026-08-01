# Skills

## Overview

Skills are reusable instruction bundles installed locally from validated sources and discovered with legacy-directory migration support. 🟢

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| SK-RF-01 | An installed skill must contain valid `SKILL.md` frontmatter and safe path/name. 🟢 | Must |
| SK-RF-02 | Minimal frontmatter parsing must resist prototype-key input. 🟢 | Must |
| SK-RF-03 | Legacy `.claude` skill discovery may migrate to `.deepseek` without duplicate registration. 🟢 | Should |

## Acceptance criteria

```gherkin
Given a candidate without valid SKILL frontmatter
When installation runs
Then the candidate is rejected without registry mutation

Given a duplicated legacy skill
When migration scans it
Then it is not installed twice
```

## Traceability

`src/skills/`, commit `c1e9b0b`. 🟢
