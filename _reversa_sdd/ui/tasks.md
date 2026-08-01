# Terminal UI — implementation tasks

- [ ] T-01 Implement app state, agent callback batching, and conversation display.
  - Origin: `src/ui/App.tsx`
  - Done when: streaming and abort states stay consistent.
  - Confidence: 🟢
- [ ] T-02 Implement command, mode, permission, plan, and verification surfaces.
  - Origin: `src/ui/App.tsx`, `interactionMode.ts`
  - Done when: every gated action has an explicit resolution path.
  - Confidence: 🟢
- [ ] T-03 Implement responsive input/setup/theme/mobile views.
  - Origin: `src/ui/input/`, `setup/`, `layout/`
  - Done when: keyboard and narrow-layout regressions pass.
  - Confidence: 🟢

## Tests

- [ ] TT-01 Permission approval and plan acceptance paths.
- [ ] TT-02 Narrow layout/Vim/mode-selection regressions.
