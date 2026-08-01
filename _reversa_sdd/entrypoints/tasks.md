# Entrypoints — implementation tasks

- [ ] T-01 Implement invocation parsing and early command dispatch.
  - Origin: `src/index.tsx`, `src/entrypoints/cli.tsx`
  - Done when: early commands avoid TUI startup.
  - Confidence: 🟢
- [ ] T-02 Implement setup/session/TUI lifecycle and terminal cleanup.
  - Origin: `src/entrypoints/cli.tsx`
  - Done when: resume and alternate screen restore safely.
  - Confidence: 🟢
- [ ] T-03 Implement noninteractive pipe safety.
  - Origin: `src/entrypoints/pipe.ts`
  - Done when: destructive confirmation is denied without UI.
  - Confidence: 🟢

## Tests

- [ ] TT-01 Version/help/doctor early paths.
- [ ] TT-02 Pipe-mode confirmation denial.
