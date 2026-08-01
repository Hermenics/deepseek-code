# Commands — implementation tasks

- [ ] T-01 Define typed command union and parser validation.
  - Origin: `src/commands.ts`
  - Done when: valid/invalid option cases are distinguishable.
  - Confidence: 🟢
- [ ] T-02 Dispatch commands into UI/agent/settings/task flows.
  - Origin: `src/ui/App.tsx`, `src/entrypoints/cli.tsx`
  - Done when: command input cannot bypass capability checks.
  - Confidence: 🟢
- [ ] T-03 Keep help and diagnostics aligned with registry.
  - Origin: `src/commands/`
  - Done when: documented forms parse in regression tests.
  - Confidence: 🟡

## Tests

- [ ] TT-01 Goal/config/plan happy paths.
- [ ] TT-02 Unknown and malformed command errors.
