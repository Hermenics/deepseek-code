# Agent — implementation tasks

- [ ] T-01 Implement initialization and context assembly.
  - Origin: `src/agent/agent.ts`
  - Done when: no turn runs before settings/steering initialization completes.
  - Confidence: 🟢
- [ ] T-02 Implement bounded streaming model/tool loop and retry policy.
  - Origin: `src/agent/agent.ts`
  - Done when: successful, malformed, cancelled, and retryable turns have distinct outcomes.
  - Confidence: 🟢
- [ ] T-03 Integrate session, memory, goal, and compaction behavior.
  - Origin: `src/agent/session.ts`, `memory.ts`, `goal.ts`
  - Done when: supported resume paths preserve context without policy override.
  - Confidence: 🟢

## Tests

- [ ] TT-01 Execute a valid tool-call turn.
- [ ] TT-02 Assert unauthorized/malformed calls have no side effect.
