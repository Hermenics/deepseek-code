# Ink renderer — implementation tasks

- [ ] T-01 Implement React host reconciliation and ANSI output ownership.
  - Origin: `src/ink/reconciler.ts`, `renderer.ts`
  - Done when: component trees render without app-level stdout calls.
  - Confidence: 🟢
- [ ] T-02 Implement layout, Unicode width, focus, scroll, and resize invariants.
  - Origin: `src/ink/`, `src/native-ts/`
  - Done when: narrow/wide text and resize tests remain aligned.
  - Confidence: 🟢

## Tests

- [ ] TT-01 Wide grapheme/frame-diff regression.
- [ ] TT-02 Focus and alternate-screen restoration regression.
