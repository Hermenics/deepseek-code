# Permissions — implementation tasks

- [ ] T-01 Implement bounded permission rule parsing and precedence.
  - Origin: `src/permissions/`
  - Done when: deny/allow/ask and wildcard limits are tested.
  - Confidence: 🟢
- [ ] T-02 Implement risk rules and session confirmations.
  - Origin: `src/permissions/risk.ts`, `src/agent/agent.ts`
  - Done when: high risk remains confirmable despite low-risk auto-approval.
  - Confidence: 🟢
- [ ] T-03 Integrate canonical filesystem safety.
  - Origin: `src/tools/file/pathSafety.ts`
  - Done when: symlink/traversal/external/sensitive cases are denied correctly.
  - Confidence: 🟢

## Tests

- [ ] TT-01 Rule precedence and ReDoS-bound patterns.
- [ ] TT-02 Risk and external-directory approval paths.
