# Bootstrap — implementation tasks

- [ ] T-01 Resolve startup prerequisites and compatibility setup.
  - Origin: `src/bootstrap/`, `src/entrypoints/cli.tsx`
  - Done when: first run reaches setup safely and normal run reaches the selected session.
  - Confidence: 🟡
- [ ] T-02 Preserve settings authority boundaries during startup.
  - Origin: `src/settings/repository.ts`
  - Done when: project config cannot enable executable features.
  - Confidence: 🟢

## Tests

- [ ] TT-01 First-run versus configured startup.
