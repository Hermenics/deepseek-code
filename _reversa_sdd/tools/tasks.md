# Tools — implementation tasks

- [ ] T-01 Implement registry and input schemas for each tool family.
  - Origin: `src/tools/index.ts`, `types.ts`
  - Done when: unknown/malformed calls cannot reach implementation.
  - Confidence: 🟢
- [ ] T-02 Implement safe file/search/shell adapters.
  - Origin: `src/tools/file/`, `Shell/`, `Grep/`, `Glob/`
  - Done when: canonical escape and sensitive files are denied.
  - Confidence: 🟢
- [ ] T-03 Implement bounded web, LSP, delegation and Git adapters.
  - Origin: `WebFetch/`, `Lsp/`, `SubAgent/`, `Git/`
  - Done when: SSRF, profile, and process boundaries have tests.
  - Confidence: 🟢

## Tests

- [ ] TT-01 Safe workspace mutation and denied escape.
- [ ] TT-02 Public fetch versus private-address denial.
