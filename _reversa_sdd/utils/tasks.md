# Utilities — implementation tasks

- [ ] T-01 Implement/redact credential and configuration helpers.
  - Origin: `src/utils/`, `src/agent/credentials.ts`
  - Done when: diagnostics never expose raw secret values.
  - Confidence: 🟢
- [ ] T-02 Implement shared filesystem, terminal, log, and update helpers.
  - Origin: `src/utils/`
  - Done when: callers have one tested implementation per boundary.
  - Confidence: 🟡

## Tests

- [ ] TT-01 Config migration and redaction.
- [ ] TT-02 Update/version helper behavior.
