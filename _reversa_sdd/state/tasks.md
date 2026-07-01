# State Module — Tasks

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Tasks for Reimplementation

### T-01: Implement State Store
- **Source:** `src/state/store.ts`
- **Description:** Singleton with getState, setState (partial merge + notify), subscribe (returns unsubscribe), resetState.
- **Done when:** State updates propagate to all subscribers, unsubscribe works.
- **Confidence:** 🟢

### T-02: Implement Selectors
- **Source:** `src/state/selectors.ts`
- **Description:** Derived state helpers for common queries.
- **Done when:** Selectors return correct derived values.
- **Confidence:** 🟢
