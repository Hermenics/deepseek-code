# Services — implementation tasks

- [ ] T-01 Implement micro-compaction eligibility and retention policy.
  - Origin: `src/services/compact/`
  - Done when: old eligible tool results shrink without deleting recent context.
  - Confidence: 🟢
- [ ] T-02 Implement structured full summary and breaker integration.
  - Origin: `src/services/compact/`, `src/agent/agent.ts`
  - Done when: failures do not cause infinite compact/retry loops.
  - Confidence: 🟢

## Tests

- [ ] TT-01 Threshold summary shape.
- [ ] TT-02 Micro compaction retention and breaker.
