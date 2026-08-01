# Shared types — implementation tasks

- [ ] T-01 Define provider and theme discriminated/shared contracts.
  - Origin: `src/types/`
  - Done when: cross-module selection is type-safe.
  - Confidence: 🟢
- [ ] T-02 Keep runtime boundary schemas alongside owning domains.
  - Origin: `src/orchestration/schema.ts`, settings validation
  - Done when: external JSON is not trusted solely because it has a TypeScript type.
  - Confidence: 🟢

## Tests

- [ ] TT-01 Typecheck provider/theme consumers.
