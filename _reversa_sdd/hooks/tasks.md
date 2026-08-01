# Hooks — implementation tasks

- [ ] T-01 Implement typed lifecycle hook runner with JSON input/output.
  - Origin: `src/hooks/`
  - Done when: valid hook output can modify/block a pre-tool request.
  - Confidence: 🟢
- [ ] T-02 Enforce timeout, result cap, failures, and user-scope restriction.
  - Origin: `src/hooks/`, `src/settings/repository.ts`
  - Done when: project configuration cannot cause execution.
  - Confidence: 🟢

## Tests

- [ ] TT-01 Pre block/modify chain.
- [ ] TT-02 Timeout and disallowed scope.
