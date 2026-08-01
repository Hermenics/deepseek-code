# Native TypeScript support — implementation tasks

- [ ] T-01 Implement node/style/layout tree and flex calculation subset.
  - Origin: `src/native-ts/`
  - Done when: renderer layout fixtures compute expected geometry.
  - Confidence: 🟢
- [ ] T-02 Implement dirty propagation and measurement cache.
  - Origin: `src/native-ts/`
  - Done when: changed descendants trigger valid re-layout without stale frame output.
  - Confidence: 🟢

## Tests

- [ ] TT-01 Dirty ancestor propagation.
- [ ] TT-02 Cached measurement versus changed content.
