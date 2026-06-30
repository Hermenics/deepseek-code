# 🔗 INTER-AGENT COMMUNICATION PROTOCOL

> This document is the **fundamental law** of the DeepSeek Code multi-agent system.
> Every agent MUST read this file before any action.

---

## 1. COLLABORATIVE DECISION MODEL

### 1.1 Principle: No Agent Decides Alone

Architectural, design, or multi-module impact decisions **MUST** go through consensus:

```
CEO proposes → Relevant agents opine → CEO decides based on opinions
```

### 1.2 Quick Consultation Protocol

When an agent needs input from another:

```markdown
## 📡 CONSULTATION: [target_agent]
**From:** [source_agent]
**About:** [topic in 1 line]
**Context:** [2-3 lines of context]
**Question:** [specific question]
**Impact if ignored:** [consequence]
```

### 1.3 Veto Protocol

Any agent can veto a decision if they identify:
- 🔴 Security risk
- 🔴 Existing test breakage
- 🔴 Violation of established architecture
- 🔴 Performance regression > 20%

Veto format:
```markdown
## 🚫 VETO: [reason in 1 line]
**Agent:** [who vetos]
**Evidence:** [concrete proof — log, test, benchmark]
**Proposed alternative:** [solution that resolves the veto]
```

---

## 2. INTER-AGENT MESSAGE FORMAT (MANDATORY)

### 2.1 Task Delegation (CEO → Agent)

```markdown
## 🎯 TASK: [ID]-[short-name]

### Context
[What is being done, why, and how it fits in the whole]

### Pre-conditions
- [x] [dependency already satisfied]
- [ ] [pending dependency — who resolves it]

### Exact Scope
**Create:** [new files]
**Modify:** [existing files]
**DO NOT touch:** [files out of scope]

### Input Contract
[Interfaces/types the code must respect]

### Output Contract
[What must be true when the task is done]

### Acceptance Criteria
- [ ] [verifiable criterion 1]
- [ ] [verifiable criterion 2]

### Expected Tests (from Tester)
- [ ] [test scenario 1]
- [ ] [test scenario 2]

### Quality Deadline
- `bun test` 100% green
- Zero `any` without justification
- Zero TypeScript warnings
```

### 2.2 Completion Report (Agent → CEO)

```markdown
## ✅ DONE: [ID]-[short-name]

### Result
[1-2 sentences about what was done]

### Files Touched
- `path/file.ts` — [what changed]

### Decisions Made
- [decision 1]: [justification]

### Risks Identified
- [risk]: [suggested mitigation]

### Test Status
- Total: X | Passing: X | Failing: 0

### Suggested Next Step
[What the next agent should do]
```

### 2.3 Blocker Report (Agent → CEO)

```markdown
## 🚨 BLOCKED: [ID]-[short-name]

### Problem
[Precise description of the blocker]

### Already Tried
1. [approach 1] → [result]
2. [approach 2] → [result]

### I Need
- [ ] [resource/decision/information needed]
- [ ] [agent that can unblock: @agent_name]

### Blocker Impact
[What doesn't progress while this isn't resolved]
```

---

## 3. UNIFIED TDD PROTOCOL

### 3.1 Mandatory TDD Flow (All Agents)

```
┌─────────────────────────────────────────────────────────┐
│  CEO: Defines contracts + acceptance criteria            │
│    ↓                                                     │
│  TESTER: Writes tests (RED) → confirms they fail        │
│    ↓                                                     │
│  CODER/DESIGNER: Implements minimum for GREEN           │
│    ↓                                                     │
│  TESTER: Validates GREEN + adds edge cases              │
│    ↓                                                     │
│  REVIEWER: Analyzes quality + security                  │
│    ↓                                                     │
│  CEO: Confirms gates + delivers                         │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Golden Rule of TDD

> **If there's no test, it doesn't exist. If the test didn't fail first, it's not TDD.**

### 3.3 Test Contract (Tester → Coder)

The Tester MUST deliver to the Coder:
1. Complete and executable test file
2. List of `it()` blocks with expected behavior
3. Necessary mocks already configured
4. Exact command to run: `bun test tests/[file].test.ts`

### 3.4 Cross Validation

After implementation, the Tester MUST:
1. Run `bun test` and confirm 100% green
2. Add at least 2 unforeseen edge cases
3. Verify that removing the code makes tests fail (proof of real coverage)

---

## 4. SINGLE-PROMPT ERROR RESOLUTION PROTOCOL

### 4.1 Philosophy: Zero Error Loops

> An error MUST be resolved completely on the first fix attempt.
> This requires: deep diagnosis BEFORE acting.

### 4.2 Diagnostic Protocol (MANDATORY before fixing)

```markdown
## 🔍 DIAGNOSIS: [error in 1 line]

### 1. Symptom
[What is happening — exact error message]

### 2. Location
[Exact file:line where the error manifests]

### 3. Root Cause (NOT the symptom)
[Why this happens — complete trace]

### 4. Impact
[Other modules/tests affected]

### 5. Proposed Fix
[Exact change — with mental diff]

### 6. Side Effects of the Fix
[What else might break with this change]

### 7. Tests that Validate the Fix
[Which tests should pass after the fix]
```

### 4.3 Anti-Loop Rule

```
IF error persists after 1 fix attempt:
  → STOP immediately
  → Redo the diagnosis from scratch (root cause was wrong)
  → Consider a completely different approach
  → NEVER apply the same fix with minimal variation

IF error persists after 2 attempts:
  → Escalate to CEO with complete report
  → CEO convenes multi-agent meeting for collaborative decision
```

### 4.4 Emergency Multi-Agent Meeting

When an error resists 2 attempts:

```markdown
## 🆘 EMERGENCY MEETING

### Problem
[Complete description]

### Attempt History
1. [attempt 1] → [why it failed]
2. [attempt 2] → [why it failed]

### Analysis by Agent
- **Coder:** [implementation perspective]
- **Tester:** [coverage perspective]
- **Reviewer:** [architecture perspective]
- **Designer:** [UI perspective, if applicable]

### Consensual Decision
[Chosen approach with justification]

### Responsible for Execution
[Designated agent]
```

---

## 5. EXPANDED QUALITY GATES

| Gate | Name | Condition | Validator | Blocking |
|------|------|-----------|-----------|----------|
| G0 | Contract | Interfaces defined and approved | CEO | ✅ |
| G1 | Red | Tests written and failing | Tester | ✅ |
| G2 | Green | Tests passing (minimum) | Coder + Tester | ✅ |
| G3 | Edge | Edge cases added and passing | Tester | ✅ |
| G4 | Review | Zero CRITICAL issues | Reviewer | ✅ |
| G5 | Integration | `bun test` complete 100% green | CEO | ✅ |
| G6 | Types | `bunx tsc --noEmit` no errors | Coder | ✅ |

**Rule: If ANY gate fails, the pipeline STOPS. No exceptions.**

---

## 6. MODEL SELECTION BY TASK

### Optimal Model Table

| Agent/Task | Model | Justification |
|------------|-------|---------------|
| CEO — Orchestration, planning | `claude-opus-4-6` | Deep reasoning, systemic vision |
| Architect — System design | `claude-opus-4-6` | Structural thinking, contracts |
| Coder — Code implementation | `gpt-5.3-codex` | Optimized for code generation |
| Tester — Tests and QA | `claude-sonnet-4-6` | Speed/quality balance |
| Reviewer — Critical analysis | `gpt-5.5` | Chain-of-thought for finding flaws |
| Debugger — Bug diagnosis | `gpt-5.5` | Deep reasoning for error tracing |
| Designer — UI/UX | `claude-sonnet-4-6` | Creativity + speed |
| Simple/repetitive tasks | `claude-haiku-4-5` | Maximum speed, minimum cost |

### Model Escalation Rule

```
IF simple task (rename, format, move) → claude-haiku-4-5
IF medium task (implement isolated feature) → claude-sonnet-4-6
IF complex task (architecture, multi-module) → claude-opus-4-6
IF deep reasoning needed → gpt-5.5
IF pure mass coding → gpt-5.3-codex
```

---

## 7. REGRESSION-FIRST PROTOCOL (Bugs Without Tests)

### When a bug is reported but no test detects it:

```
┌─────────────────────────────────────────────────────────┐
│  1. CEO identifies: "bug exists, no test catches it"    │
│    ↓                                                     │
│  2. TESTER writes test that REPRODUCES the bug          │
│    ↓                                                     │
│  3. Confirms: test FAILS (proof the bug is real)        │
│    ↓                                                     │
│  4. CODER fixes the bug                                 │
│    ↓                                                     │
│  5. Confirms: test PASSES (proof the fix works)         │
│    ↓                                                     │
│  6. Test remains in the suite (prevents regression)     │
│    ↓                                                     │
│  7. REVIEWER validates the fix doesn't introduce bugs   │
└─────────────────────────────────────────────────────────┘
```

### Inviolable Rule
> **NEVER fix a bug without first having a test that reproduces it.**
> **If you can't reproduce it in a test, you don't understand the bug.**

### Report Format
```markdown
## 🐛 BUG REPORT: [short description]

### Reproduction
[Exact steps to reproduce]

### Expected Behavior
[What should happen]

### Actual Behavior
[What is happening]

### Reproduction Test
`tests/regression/[name].test.ts`

### Cause Hypothesis
[Where the problem probably is]
```

---

## 8. PRE-MORTEM ANALYSIS (Anticipate Failures)

### Before implementing any complex feature:

The CEO MUST conduct a **pre-mortem** — imagine the feature has already been implemented and FAILED. Ask:

```markdown
## 💀 PRE-MORTEM: [feature]

### "The feature failed. Why?"
1. [failure scenario 1] → [mitigation]
2. [failure scenario 2] → [mitigation]
3. [failure scenario 3] → [mitigation]

### Blind Spots
- [something we don't know and could surprise us]

### Fragile Dependencies
- [module/API/service that might fail]

### Plan B
- [what to do if the main approach doesn't work]
```

This PREVENTS errors instead of just reacting to them.

---

## 9. CONFIDENCE SCORING

### Every agent MUST declare their confidence when delivering:

```markdown
### Confidence: [HIGH | MEDIUM | LOW]
- **HIGH** (90%+): Tested, verified, completely understood
- **MEDIUM** (60-90%): Works but there are uncertainties I couldn't verify
- **LOW** (<60%): Partial solution, needs additional validation
```

### Confidence Rules
- If LOW confidence → CEO should request extra validation before proceeding
- If MEDIUM confidence → Reviewer should pay extra attention to that area
- If HIGH confidence → normal flow

### When to Declare LOW Confidence (mandatory)
- Code that interacts with external APIs without available mock
- Concurrency/timing logic
- Code that depends on undocumented behavior
- First time working with this module

---

## 10. KNOWLEDGE ACCUMULATION (Continuous Learning)

### After resolving any non-trivial bug or problem:

The responsible agent MUST register the learning in `CLAUDE.md`:

```markdown
## Learning: [date]
**Problem:** [what happened]
**Cause:** [why it happened]
**Solution:** [how it was resolved]
**Prevention:** [how to avoid in the future]
```

### Known Error Patterns (update continuously)
- If the same type of error occurs 2+ times → create preventive rule
- If a module causes frequent problems → mark for refactoring
- If a dependency is unstable → document workarounds

---

## 11. ROLLBACK PROTOCOL (When the Fix Makes Things Worse)

### If a fix introduces more problems than it solves:

```
1. STOP immediately
2. Revert ALL changes (git checkout or manual undo)
3. Confirm previous state is restored (bun test)
4. Document: "approach X failed because Y"
5. CEO convenes analysis with completely different approach
```

### Signs you should rollback:
- More tests failing AFTER the fix than before
- Fix resolves 1 problem but creates 2 new ones
- Fix complexity is disproportionate to the problem
- Fix requires changes in 5+ files for a simple bug

---

## 12. PARALLEL EXECUTION HINTS

### What CAN run in parallel:
- Tester writing tests + Designer creating UI (if independent)
- Reviewer analyzing module A + Coder implementing module B
- Multiple tests from different modules

### What NEVER runs in parallel:
- Implementation BEFORE tests exist
- Review BEFORE implementation is done
- Two agents modifying the SAME file
- Bug fix BEFORE the reproduction test

---

## 13. SELF-HEALING PATTERNS

### Patterns that agents should follow for self-correction:

**Pattern 1: Verify-Before-Report**
```
Before reporting "done":
  1. Run bun test (module)
  2. Run bun test (complete suite)
  3. Run bunx tsc --noEmit
  4. IF any failure → fix BEFORE reporting
```

**Pattern 2: Read-Before-Write**
```
Before modifying any file:
  1. Read the ENTIRE file
  2. Understand the context (imports, exports, dependencies)
  3. Identify tests that cover this file
  4. ONLY THEN modify
```

**Pattern 3: Minimal-Change**
```
For any fix:
  1. Identify the SMALLEST change that resolves it
  2. Don't refactor adjacent code in the same PR
  3. Don't "improve" things that aren't broken
  4. One change, one purpose
```

**Pattern 4: Blast-Radius-Check**
```
Before any change to a shared module:
  1. Grep for all imports of this module
  2. List all consumers
  3. Verify the change is backward-compatible
  4. If not → update ALL consumers
```

---

## 14. GIT WORKFLOW (BRANCH + PR MANDATORY)

### Rule: NEVER work directly on main.

All work — feature, bugfix, refactoring — MUST follow:

```
1. Create descriptive branch: feat/name, fix/name, refactor/name, chore/name
2. Make commits on the branch (clear messages)
3. When done: push with -u to origin
4. Open PR on GitHub via `gh pr create`
5. NEVER push directly to main
6. NEVER merge locally to main
```

### Branch Naming

| Type | Prefix | Example |
|------|--------|---------|
| New feature | `feat/` | `feat/mcp-http-transport` |
| Bug fix | `fix/` | `fix/streaming-hang` |
| Refactoring | `refactor/` | `refactor/tool-registry` |
| Maintenance/config | `chore/` | `chore/update-deps` |
| Tests | `test/` | `test/coverage-edge-cases` |

### CEO Flow When Finishing Pipeline

```
Gates G0-G6 passed?
  → git add (specific files, NEVER -A)
  → git commit with descriptive message
  → git push -u origin <branch>
  → gh pr create --title "..." --body "..."
  → Report PR URL to user
```

### Git Safety Rules

- NEVER `git push --force` without explicit user permission
- NEVER `git reset --hard` without explicit permission
- NEVER commit .env, secrets or credentials
- Prefer atomic commits (1 purpose per commit)
- If pre-commit hook fails: fix and create NEW commit (never --amend)

---

## 15. UNIVERSAL RULES

1. **Language:** All inter-agent communication is in English.
2. **Test location:** ALWAYS in `tests/` at root. NEVER in `src/`.
3. **Verification:** Every agent MUST run `bun test` before reporting completion.
4. **Transparency:** Non-obvious decisions MUST be documented with justification.
5. **Autonomy with responsibility:** Agents can act within delegated scope, but MUST escalate when out of scope.
6. **Zero tolerance for regression:** If a passing test starts failing, it is MAXIMUM priority.
7. **Mandatory reading:** Every agent reads `CLAUDE.md` + `PROTOCOL.md` before acting.

---

## 16. ANTI-PATTERNS (FORBIDDEN IN THE SYSTEM)

- ❌ Agent implements without tests existing
- ❌ Agent modifies another agent's test without CEO authorization
- ❌ Agent ignores security veto
- ❌ Agent reports "done" without running `bun test`
- ❌ Agent applies fix without complete diagnosis
- ❌ Agent makes architectural decision without consulting CEO
- ❌ CEO advances pipeline with failing gate
- ❌ Any agent uses a language other than English in communication
