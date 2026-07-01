# Settings Module — Tasks

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Tasks for Reimplementation

### T-01: Implement Settings Types
- **Source:** `src/settings/types.ts`
- **Description:** Define DeepSeekSettings interface with all optional fields. PermissionsConfig, SettingsLevel.
- **Done when:** Types cover all known settings fields.
- **Confidence:** 🟢

### T-02: Implement Settings Loader
- **Source:** `src/settings/index.ts`
- **Description:** Load from 3 paths in parallel. Strip hooks from project/local. Merge with priority.
- **Done when:** All levels load, hooks stripped from untrusted, merge correct.
- **Confidence:** 🟢

### T-03: Implement Merge Algorithm
- **Source:** `src/settings/index.ts`
- **Description:** Arrays: concat+dedup. Objects: deep merge one level. Scalars: override.
- **Done when:** All merge cases handled correctly.
- **Confidence:** 🟢
