# Settings — implementation tasks

- [ ] T-01 Define settings types, defaults, bounds, and secret filters.
  - Origin: `src/settings/types.ts`, `repository.ts`
  - Done when: invalid/sensitive boundary input is rejected.
  - Confidence: 🟢
- [ ] T-02 Implement hierarchy, merge, origin diagnostics, and atomic persistence.
  - Origin: `src/settings/repository.ts`
  - Done when: per-scope overrides have predictable effective values.
  - Confidence: 🟢
- [ ] T-03 Enforce user-only executable capabilities.
  - Origin: `src/settings/repository.ts`
  - Done when: repository configuration cannot run commands by itself.
  - Confidence: 🟢

## Tests

- [ ] TT-01 Merge/validation/origin snapshot.
- [ ] TT-02 Project-scope hooks, LSP, MCP and auto denials.
