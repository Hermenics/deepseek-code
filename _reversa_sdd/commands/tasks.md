# Commands Module — Tasks

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Tasks for Reimplementation

### T-01: Implement Command Router
- **Source:** `src/commands/index.ts`
- **Description:** Parse slash input, match command name, dispatch to handler, return CommandResult.
- **Done when:** All 26 commands routed correctly, unknown commands return error message.
- **Confidence:** 🟢

### T-02: Implement Effort Command
- **Source:** `src/commands/effort/index.ts`
- **Description:** `/effort` shows current level. `/effort [low|high|max]` changes it.
- **Done when:** Status displayed, level changed, invalid values rejected.
- **Confidence:** 🟢

### T-03: Implement Model Command
- **Source:** `src/commands/model/index.ts`
- **Description:** Switch active model. Update context limit. Propagate to SubAgent.
- **Done when:** Model switches, context limit recalculated.
- **Confidence:** 🟢

### T-04: Implement RC (Remote Control) Command
- **Source:** `src/commands/rc/`
- **Description:** Subcommands: start (begin pairing), stop, status, devices (list), unpair.
- **Done when:** QR code generated for pairing, device trust managed.
- **Confidence:** 🟢

### T-05: Implement Remaining Commands
- **Source:** `src/commands/*/`
- **Description:** Implement help, clear, compact, undo, history, checkpoint, cost, mode, and others.
- **Done when:** Each command produces correct CommandResult and side effects.
- **Confidence:** 🟢
