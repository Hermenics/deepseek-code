# Tools Module — Tasks

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Tasks for Reimplementation

### T-01: Implement Tool Interface and Registry
- **Source:** `src/tools/types.ts`, `src/tools/index.ts`
- **Description:** Define Tool interface (name, description, parameters, execute). Export allTools array.
- **Done when:** All 15 tools registered, interface enforced.
- **Confidence:** 🟢

### T-02: Implement Path Safety Module
- **Source:** `src/tools/shared/pathSafety.ts`
- **Description:** assertSafePath() with CWD containment, blocked dirs, symlink check, sensitive file patterns.
- **Done when:** All 4 checks pass/fail correctly, BLOCKED_GLOB_PATTERNS exported.
- **Confidence:** 🟢

### T-03: Implement Shell Tool
- **Source:** `src/tools/Shell/Shell.ts`
- **Description:** Execute commands via child_process.spawn. 30s timeout, 50k char truncation, confirm handler.
- **Done when:** Commands execute, output captured, timeout works, destructive patterns detected.
- **Confidence:** 🟢

### T-04: Implement ReadFile Tool
- **Source:** `src/tools/ReadFile/ReadFile.ts`
- **Description:** Read file with path sandbox check. Return contents or error.
- **Done when:** Files read successfully, sandbox violations throw.
- **Confidence:** 🟢

### T-05: Implement WriteFile Tool
- **Source:** `src/tools/WriteFile/WriteFile.ts`
- **Description:** Write content to file. Create checkpoint before write. Validate via assertSafePath.
- **Done when:** Files written, directories auto-created, checkpoint captured.
- **Confidence:** 🟢

### T-06: Implement PatchFile Tool
- **Source:** `src/tools/PatchFile/PatchFile.ts`
- **Description:** Apply unified diff patch. Validate path. Create checkpoint before modification.
- **Done when:** Patches apply correctly, rejects invalid diffs.
- **Confidence:** 🟢

### T-07: Implement Glob Tool
- **Source:** `src/tools/Glob/Glob.ts`
- **Description:** Pattern-based file search. Cap at 500 results. Exclude BLOCKED_GLOB_PATTERNS.
- **Done when:** Glob patterns match correctly, blocked dirs excluded.
- **Confidence:** 🟢

### T-08: Implement Grep Tool
- **Source:** `src/tools/Grep/Grep.ts`
- **Description:** Content search across files. Cap at 200 lines. Respect blocked dirs.
- **Done when:** Pattern matches returned with file:line format.
- **Confidence:** 🟢

### T-09: Implement WebFetch Tool
- **Source:** `src/tools/WebFetch/WebFetch.ts`
- **Description:** HTTP GET with URL validation, SSRF blocking (pre+post DNS), 15s timeout, 20k char cap.
- **Done when:** URLs fetched, private IPs blocked pre and post DNS resolution.
- **Confidence:** 🟢

### T-10: Implement SubAgent Tool
- **Source:** `src/tools/SubAgent/SubAgent.ts`, `permissions.ts`, `memory.ts`
- **Description:** Spawn child Agent. Infer role. Filter tools. 15-iteration limit. Memory reset per turn. Verification.
- **Done when:** SubAgent spawns with correct role, tools filtered, memory isolated per turn.
- **Confidence:** 🟢

### T-11: Implement MoA Tool
- **Source:** `src/tools/MoA/`
- **Description:** Query reference models in parallel. Collect responses. Synthesize via aggregator. Handle timeouts.
- **Done when:** Multiple models queried, aggregator synthesizes, min 1 response enforced.
- **Confidence:** 🟢

### T-12: Implement Todo, Introspect, UpdateKnowledge, Git
- **Source:** `src/tools/Todo/`, `src/tools/Introspect/`, `src/tools/UpdateKnowledge/`, `src/tools/Git/`
- **Description:** Implement remaining utility tools with their specific behaviors.
- **Done when:** Each tool executes its operation and returns formatted result.
- **Confidence:** 🟢
