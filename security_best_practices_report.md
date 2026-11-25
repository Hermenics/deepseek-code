# Scoped Security and Integration Review

Date: 2026-11-24

## Executive summary

The review covered pipe JSONL/output-schema handling, aggregate budget usage and warnings, compaction continuity, and the matching README, CLI help, and Introspect contracts. Three correctness gaps were fixed, and one documentation ambiguity was clarified. No confirmed prompt-injection path or sensitive-data leak was found in the reviewed changes. Budget enforcement itself remained active; the budget finding affected warning delivery.

## Findings

### Low — Budget warnings could watch the previous turn's group

**Location:** `src/agent/agent.ts:3666-3668`; `src/ui/App.tsx:1614-1625`

**Cause and impact:** `Agent.run()` awaits initialization before assigning the new budget-group ID. The UI read the current ID immediately after calling the async method, so the first run had no watcher and later runs could attach to the previous ID. Enforcement remained in place, but the per-group warning could be missing or attributed to the wrong run.

**Correction:** Added an `onAggregateBudgetGroup` callback, fired after the ID is assigned and before model requests. The UI now registers the watcher from that callback.

**Verification:** Added a regression test that runs consecutive turns and checks that the watcher receives the ID used by the new model request and reports the reached limit.

### Low — Literal schema data could be mistaken for a `$ref`

**Location:** `src/entrypoints/pipe.ts:87-119`

**Cause and impact:** The local-reference check recursively inspected every object value, including instance data under `const` or `enum`. A valid schema whose required literal object contained a `$ref` key could therefore be rejected as requiring a remote resolver.

**Correction:** Reference checks now follow schema-bearing keywords only. Actual remote references in nested schema positions remain rejected.

**Verification:** Added tests for both a literal `$ref` value and a real nested remote `$ref`; both cases behave as intended.

### Low — Empty or malformed compaction state labels passed validation

**Location:** `src/services/compact/summaryPrompt.ts:60-64`

**Cause and impact:** The previous label check allowed `\s` to cross line boundaries and did not require text after the colon. An empty state label could pass validation before the original history was discarded.

**Correction:** Validation now requires each label as a bullet with a non-whitespace value on the same line.

**Verification:** Added regression cases for an empty value and a label split across lines; the compaction tests pass.

### Low — Introspect wording blurred final-output errors and schema preflight errors

**Location:** `src/tools/Introspect/Introspect.ts:329`

**Cause and impact:** The previous wording could imply that an invalid schema file itself produced validation `issues`. In the implementation, `issues` are included for parsing the final response as JSON or validating it against the schema; schema-file preflight errors carry the error message without `issues`.

**Correction:** Introspect now distinguishes final-response parse/validation failures from schema-file preflight failures. README, CLI help, and the project capability guide also state that unsupported keywords and unregistered formats fail under the configured strict Ajv draft-07 validator.

**Verification:** Compared the documentation against `src/entrypoints/pipe.ts` and checked the rendered CLI help.

## Verification

- `bun test tests/pipeArgs.test.ts tests/primary-agent-usage.test.ts tests/task-aggregate-budget.test.ts tests/compact-enhanced.test.ts --parallel=1 --max-concurrency=1 --timeout=15000` — 44 passed, 0 failed.
- `bun run typecheck` — passed.
- `bun src/index.tsx --help` — passed; help output includes the JSONL and output-schema contract.
- `git diff --check` — passed.

No live provider request was made. JSONL runtime behavior was verified through focused unit tests and CLI help rather than a provider-backed end-to-end run.
