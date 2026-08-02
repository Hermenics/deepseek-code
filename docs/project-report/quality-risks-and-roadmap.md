# Quality, Risks, and Roadmap

> Companion to the [DeepSeek Code Project Report](../PROJECT-REPORT.md).  
> Snapshot: `v0.6.0` · 2026-08-02.

## 1. Quality strategy

DeepSeek Code's quality model is contract-heavy. Tests focus not only on successful agent behavior, but also on boundaries that can corrupt state or elevate authority: schema rejection, path escape, permission precedence, cancellation, timeout, task recovery, output validation, symlink handling, concurrent persistence, replay divergence, and npm package execution.

The project uses Bun as runtime and test runner, TypeScript strict checking as the compile-time gate, and a build/package smoke test as the distribution gate. The marketing website has an independent Node/npm pipeline.

## 2. Repository test topology

At `v0.6.0`, `tests/` contains 118 files and 17,969 lines. A static scan across the root tests and website source finds roughly 1,558 `test`/`it` declarations. Counts are descriptive and may include parameterized/generated declarations; CI results are the authoritative execution record.

| Test area | Main concerns |
| --- | --- |
| Agent | Initialization, authorization, provider behavior, prompt refinement, sessions, goals, cancellation |
| Tools | Schemas, path safety, file mutation, shell, Git, web fetch, LSP, memory, plans/goals |
| Subagents | Profiles, model/effort propagation, worktrees, terminal envelopes, schema correction |
| Orchestration | DAG admission, concurrency, retries, timeouts, cancellation, messages, snapshots, integration |
| Dynamic Workflows | Parser, VM runtime, manager, replay, persistence, discovery, commands, monitor, public tool |
| Settings/permissions/hooks | Scope rules, merge/provenance, secret rejection, risk matching, executable authority |
| Ink/TUI | Layout, input, focus, screen diff, messages, dialogs, status, narrow terminals |
| Plugins/skills | Source/name validation, install/update rollback, manifests, registry |
| Experimental kernel | SQLite/event/thread/workflow research contracts, separate from production wiring |
| Website | Basic React application behavior plus lint/build in its own job |

## 3. Release gates

### Root package

| Command | What it proves |
| --- | --- |
| `bun run typecheck` | TypeScript contracts compile without emission |
| `bun test` | Broad repository test discovery, including ancillary test surfaces |
| `bun run test:coverage` | Root `tests/` suite passes and produces LCOV |
| `bun run build` | Bun can bundle the production CLI and generate the executable wrapper |
| `bun run pack:check` | Published package shape and installed executable work in a temporary consumer |

Additional focused commands are `bun run test:ink` and `bun run test:plugins`.

### CI workflow

The primary job uses Bun 1.3.13 and a frozen install. It runs typecheck, coverage, build, and package verification, then uploads LCOV. Frozen dependency installation makes lockfile drift a visible failure.

The website job uses Node 24 and npm. It runs `npm ci`, lint, CI tests, and production build inside `website/`.

### Latest observed release-candidate validation

| Gate | Outcome |
| --- | --- |
| Typecheck | Passed |
| Full `bun test` | 1,555 passed · 3 skipped · 0 failed |
| Coverage test command | 1,554 passed · 3 skipped · 0 failed |
| Production build | Passed |
| Package verification | Passed, including installed-package smoke test |

These are results observed in the workspace immediately before the release/version-only commits. The GitHub Actions run for the merged release independently passed according to the release workflow history supplied during development.

## 4. Dynamic Workflow test coverage

Release `0.6.0` adds focused suites under `tests/workflows/`:

| Suite | Contract surface |
| --- | --- |
| `parser.test.ts` | Metadata parsing, size boundary, unclosed object, formatter round trip |
| `runtime.test.ts` | Globals, blocked context access, errors, cancellation, host/vm timeouts, infinite loop |
| `manager.test.ts` | Run lifecycle, agents/options, pause ordering, limits, replay, divergence, corruption, incomplete journal |
| `storage.test.ts` | Atomic/private writes, restore, approval concurrency, bounded replay |
| `discovery.test.ts` | Local/global precedence, invalid files, containment, symlink escape, bounded directory work |
| `commands.test.ts` | Workflow command parsing and public control verbs |
| `monitor.test.ts` | TUI workflow summary rendering |
| `tool.test.ts` | Public `Workflow` tool result serialization and cancellation propagation |

Cross-cutting tests also cover prompt-refiner preservation of the Dynamic Workflow concept, agent initialization/authorization, settings validation, and subagent executor schema behavior.

The test design correctly separates two timeout classes: the host timeout for a complete run and the 1,000 ms VM synchronous cap for a tight loop. The latter must surface the VM-specific “Script execution timed out” message so users understand why a larger overall timeout did not allow blocking JavaScript to continue.

## 5. Build and distribution quality

The build produces two important artifacts:

- `dist/cli.mjs`, the bundled ESM application.
- `dist/deepseek`, the executable shell wrapper exposed by the npm `bin` map.

The wrapper verifies that Bun exists and satisfies the supported engine, then protects terminal restoration across normal exit and signals. This matters because a TUI crash can otherwise leave cursor, paste, mouse, or alternate-screen state broken.

Only `dist/`, `README.md`, and `LICENSE` are published. `pack:check` verifies the tarball rather than trusting `package.json` intent. It is one of the highest-value release gates because it exercises the actual consumer boundary.

## 6. Codebase size and concentration

### Area distribution

| Area | Files | Lines | Assessment |
| --- | ---: | ---: | --- |
| Renderer (`src/ink`) | 99 | 19,565 | Largest complex subsystem; broad terminal compatibility responsibility |
| Public/static data (`src/public`) | 2 | 15,669 | Large line count but low control-flow complexity |
| TUI (`src/ui`) | 78 | 8,914 | Many components, with integration concentrated in `App.tsx` |
| Agent (`src/agent`) | 29 | 5,249 | Provider/context concerns modularized, core loop still centralized |
| Tools (`src/tools`) | 37 | 3,101 | Healthy folder-per-capability organization |
| Native layout (`src/native-ts`) | 2 | 2,712 | Algorithmic concentration in one Yoga-compatible file |
| Experimental kernel | 14 | 2,854 | Separate research architecture with conceptual overlap |
| Orchestration | 14 | 2,121 | Compact production coordination layer with high responsibility |
| Dynamic Workflows | 8 | 1,203 | Cohesive release-sized subsystem; manager slightly exceeds file rule |

### Files exceeding the project guideline

The project rule says files should remain below 500 lines. Current exceptions include:

| File | Lines | Risk |
| --- | ---: | --- |
| `src/native-ts/yoga-layout/index.ts` | 2,578 | Dense layout algorithm; difficult localized review |
| `src/agent/agent.ts` | 1,904 | Core model loop plus initialization, permissions, persistence, workflows |
| `src/ui/App.tsx` | 1,881 | UI state and handlers for most product capabilities |
| `src/ink/ink.tsx` | 1,754 | Renderer lifecycle, scheduling, input, terminal behavior |
| `src/ink/components/App.tsx` | 657 | Renderer application component behavior |
| `src/workflows/manager.ts` | 505 | Just over threshold; cohesive but still an emerging integration point |

`src/orchestration/TaskRegistry.ts` is 498 lines and therefore exactly at the practical boundary.

The line rule should not trigger arbitrary splitting. A useful extraction must create a stable responsibility boundary with tests and fewer reasons to edit the original file. Splitting by line range or creating one-use wrapper classes would worsen the architecture.

## 7. Maintainability findings

### 7.1 Agent as composition root and god-object pressure

🟡 `Agent` legitimately coordinates many concerns, but it also owns enough implementation detail that provider, permissions, workflow, session, and turn-state changes can collide. The class remains the correct composition root; the opportunity is to extract already-cohesive state machines/services, not replace it with abstract factories.

Strong extraction candidates are workflow authorization/wiring, turn execution state, and session/context initialization. Each candidate should move only when its tests can target the boundary directly.

### 7.2 TUI state concentration

🟡 `ui/App.tsx` is the visible integration point for almost every feature. Adding commands or approval surfaces increases hook/state coupling and makes keyboard regressions more likely.

The best incremental direction is feature controllers/hooks that own a complete concern—workflow monitoring and permissions are examples—while `App` remains the render composition root. Avoid a global state framework unless React-local decomposition proves insufficient.

### 7.3 Renderer ownership

🟡 The in-tree Ink renderer is both a moat and a maintenance liability. It gives the project control over behavior that matters deeply in an AI terminal, but React reconciler changes, Unicode width, bidirectional text, selection, focus, resize, and terminal variants require continued regression coverage.

The architectural answer is not to replace it reflexively. Preserve the public renderer contract and split lifecycle/input/scheduling internals only where the existing tests provide confidence.

### 7.4 Production versus experimental orchestration

🟡 The production path is clear in code imports but not obvious from directory names alone. `src/kernel/` contains an alternate SQLite/event/thread/workflow architecture that is not imported by production. Contributors may spend time modifying or designing against the wrong stack.

A short boundary README or explicit `experimental` naming would cheaply remove ambiguity. Activate or merge the kernel only with a written migration decision and parity plan.

### 7.5 Persistence path transition

🟡 Modern state predominantly uses `~/.deepseek` and project `.deepseek`, while some plugin/checkpoint compatibility paths use `.deepseek-code`. Compatibility prevents user data loss, but new code must not add more competing roots.

Centralize new paths through existing helpers and document which legacy roots are read-only migration sources versus still-authoritative destinations.

### 7.6 Documentation drift

🟡 The prior Reversa snapshot is based on `v0.4.15`; it reports 23 tools and 38 commands and cannot describe `src/workflows/`. Some README defaults, such as alternate-screen behavior, can lag source defaults.

This report corrects the snapshot but does not automatically prevent the next drift. Small generated/checkable facts are more valuable than repeatedly rewriting prose.

### 7.7 Website toolchain

🟡 The website is small but uses the Create React App/CRACO generation of tooling, which has a broader maintenance surface than the landing page itself. Existing overrides and CI reduce immediate risk.

Migration is not urgent while installs, lint, tests, and build remain stable. Consider a smaller static toolchain only when dependency upgrades or build performance create measurable friction.

### 7.8 Tool registry and mode-matrix drift

🟡 The root tool registry contains `edit_file`, `moa`, `create_goal`, `get_goal`, and `update_goal`, but `TOOL_PERMISSIONS.build` omits them. Auto mode accepts them through its explicit all-tools branch. `Introspect` states that Build includes `edit_file`, and goal flows instruct the model to call `update_goal`, so the runtime matrix and product contract disagree.

The current interaction-mode tests confirm selected entries but do not compare registered tools against a declared mode classification. This is a release-valid implementation inconsistency, not merely stale prose.

## 8. Reliability assessment

| Reliability concern | Current mitigation | Remaining exposure |
| --- | --- | --- |
| Provider outage/rate limits | Bounded retry/backoff and explicit errors | Provider-specific failure shapes and partial usage reporting |
| Context overflow | Micro/full compaction, threshold and failure circuit breaker | Summary quality is model-dependent |
| Long-running tool | Abort signals and timeouts | Child processes may not always terminate instantly across platforms |
| Concurrent writers | Worktree-first isolation, leases, overlap checks | Complex Git states and external edits remain real-world edge cases |
| Process crash | Atomic snapshots/journals and conservative restore | In-flight external side effects cannot always be rolled back |
| Corrupt state | Schema validation and skip/recovery behavior | Migration breadth grows with every persisted version |
| Infinite workflow JS | VM synchronous timeout + Worker termination | CPU pressure exists until the cap fires |
| Budget exhaustion | Admission stops; active calls may finish | Final usage can exceed the boundary by already-admitted work |
| Observer/log failure | Observer isolation and local error handling | Diagnostics may be incomplete when storage itself is failing |
| Terminal interruption | Signal-aware wrapper and renderer cleanup | Host terminal/emulator differences need continuous testing |

## 9. Security assessment

| Security property | Maturity | Notes |
| --- | --- | --- |
| Tool input validation | High | Typed schemas and runtime validation at boundaries |
| Filesystem containment | High | Canonical/symlink-safe shared resolver and sensitive-path rules |
| Permission layering | High | Mode, risk, rules, profile, hooks, approval |
| Writer isolation | High | Worktree-first, serialized fallback, explicit integration |
| Executable project config | High | User-scoped hooks/LSP/MCP authority |
| Workflow consent | High | Exact SHA-256 content plus project binding, child approval |
| Workflow sandbox claim | Appropriate | Explicit defense-in-depth framing, constrained host RPC |
| Secret handling | Medium-high | Separation/redaction/private modes; child processes remain user-authorized trust |
| Supply-chain surface | Medium | 34 runtime dependencies plus extension sources and website toolchain |
| Multi-tenant isolation | Not applicable | Product is a single-user local CLI |

## 10. Product maturity assessment

The scores are architectural judgments, not automated metrics.

| Dimension | Score | Evidence |
| --- | ---: | --- |
| Core coding loop | 9/10 | Provider-aware, streaming, cancellable, tool-driven, compacting, persistent |
| Tooling breadth | 9/10 | 24 built-ins across code, execution, coordination, plans, goals, memory |
| Multi-agent coordination | 8.5/10 | Bounded DAG, worktrees, messages, review, MoA, recovery |
| Dynamic Workflows | 8/10 | Rich production core in first release; UI discoverability/ergonomics can mature |
| Safety/authority | 8.5/10 | Layered and well-tested; local executable extensions remain explicit trust decisions |
| TUI experience | 8.5/10 | Deep renderer/input investment; integration component is oversized |
| Provider portability | 8/10 | Four providers with honest differences; catalog/protocol upkeep is continuous |
| Persistence/recovery | 8/10 | Atomic/versioned/conservative; growing number of stores and legacy paths |
| Distribution | 9/10 | Build plus actual packed-consumer smoke test |
| Maintainability | 6.5/10 | Good subsystem boundaries offset by several large integration/algorithm files |
| Documentation | 7.5/10 | Rich specialized artifacts; automated release-truth checks are missing |

Overall: **8.1/10**. The codebase is strong for a pre-1.0 developer tool. The limiting factor is change cost in central modules, not lack of capabilities.

## 11. Prioritized roadmap

### P0 — keep release truth accurate

#### P0.1 Check factual documentation

🔵 Add one small script/test that reads `package.json`, `allTools`, the command registry, default settings, and workflow constants, then verifies a generated factual block or fixture. It should cover only facts that drift mechanically: version, counts, default mode/provider, and limits.

**Why now:** `0.6.0` changed tool/command counts and added an entire coordination subsystem after the previous documentation snapshot.

**Done when:** CI fails if the documented factual snapshot disagrees with registries/constants.

#### P0.2 Reconcile registered tools with interaction modes

🔵 Decide the intended Build classification for `edit_file`, `moa`, and the three goal tools, update `TOOL_PERMISSIONS` and `Introspect` together, and add a completeness test requiring every built-in tool to be explicitly classified or intentionally Auto-only.

**Why now:** the goal prompt currently asks the model to call a tool that Build mode rejects, while `edit_file` is advertised but unreachable in normal Build execution.

**Done when:** the registry, mode matrix, introspection text, and interaction-mode tests express one contract.

#### P0.3 Clarify the kernel

🔵 Add an explicit `src/kernel/README.md` or equivalent module header saying the kernel is experimental and disconnected from production. Include the supported production mapping: `src/orchestration` + `src/workflows`.

**Why now:** two directories contain workflow/task concepts with different persistence and runtime models.

**Done when:** a new contributor can identify the supported scheduler without import archaeology.

#### P0.4 Preserve workflow trust language

🔵 Keep approval UI/help explicit that persistent approval means “this exact script in this project,” and that VM execution is not an absolute sandbox.

**Done when:** help, footer keys, and documentation use the same terms and options.

### P1 — reduce central coupling

#### P1.1 Extract workflow UI state

🔵 Move workflow subscriptions, permission request resolution, monitor state, and command handling from `ui/App.tsx` into one cohesive hook/controller while keeping rendering components presentational.

**Why this boundary:** Dynamic Workflows already have a distinct manager/event API and test surface.

**Avoid:** introducing a global state library or generic event framework.

#### P1.2 Extract turn execution from Agent

🔵 Separate the bounded model/tool turn state machine from initialization/settings/session orchestration. Keep `Agent` as the public composition root.

**Why this boundary:** turn cancellation, streaming, tool continuation, and terminal completion form a coherent lifecycle.

**Done when:** provider/tool-loop tests can instantiate the turn executor without bootstrapping unrelated UI/session extensions.

#### P1.3 Split renderer internals behind the current API

🔵 Isolate terminal lifecycle, render scheduling/frame emission, and input dispatch from `src/ink/ink.tsx`. Preserve `createRoot`/component contracts and use existing Ink regression tests.

**Avoid:** replacing the renderer solely to reduce line count; product behavior is more important than a metric.

#### P1.4 Decompose Yoga by algorithmic responsibility

🔵 Extract measurement/cache, flex line resolution, and final layout application into testable modules if the existing implementation naturally supports those seams.

**Done when:** each extraction reduces reasons to modify the 2,578-line file and does not create pass-through wrappers.

### P2 — operational and product polish

#### P2.1 Rich workflow selector and monitor

🔵 Build the planned footer/selector when it is part of a minor release: saved-workflow discovery, active runs, phases, usage, worktrees, and control keys should share one navigable surface. Preserve `/workflow` commands for scriptability.

#### P2.2 Persistence root convergence

🔵 Define a migration table for `.deepseek-code` plugin/checkpoint paths. New writes should converge on `.deepseek`; legacy reads should have an explicit deprecation window before removal.

#### P2.3 Provider contract matrix

🔵 Maintain fixtures for streaming, reasoning fields, tool calls, usage, context limits, and error mapping per supported provider family. Tie model catalog additions to this matrix.

#### P2.4 Coverage floor after baseline

🔵 Record current line/function coverage, exclude generated/static public data deliberately, and introduce a non-regression floor only after the team agrees on meaningful scope.

**Avoid:** using test count as a quality target or forcing coverage on static data.

#### P2.5 Website simplification trigger

🔵 Keep the current website stack until one of three measurable triggers occurs: unsupported security dependency, repeatedly broken install/build, or material build/development latency. Then migrate to the smallest static React-capable toolchain that preserves design.

### Deferred unless a real requirement appears

- Distributed/multi-host task scheduling.
- Server-side account/team permissions.
- Automatic worktree integration or merging.
- Recursive workflow composition beyond one child layer.
- SQLite activation for production merely because `src/kernel` already contains it.
- Additional workflow configuration knobs for structural constants.
- OpenTelemetry or remote analytics without a concrete operator need and privacy design.

## 12. Contributor workflow

### Local validation loop

```bash
bun install
bun run typecheck
bun test
bun run build
bun run pack:check
```

Use focused tests while iterating, then run the complete gates before release. For changes limited to the renderer or plugins, `bun run test:ink` and `bun run test:plugins` shorten feedback but do not replace the full suite.

### Change-specific minimums

| Change type | Minimum focused validation before full suite |
| --- | --- |
| Tool or permission | Schema tests, denial/risk/path tests, successful call |
| Agent/provider | Streaming/non-streaming fixture, cancellation, tool continuation, usage |
| Orchestration | State transitions, concurrency/dependency, cancellation, snapshot restore |
| Workflow runtime | Worker startup timeout, cancellation, synchronous VM timeout, settled RPC |
| Workflow storage | Atomic/private writes, concurrency, corruption, replay divergence |
| TUI | Handler/monitor test plus relevant Ink/input regression |
| Settings | Type validation, scope authority, merge/provenance, atomic write |
| Package | Build and `pack:check` |

### Definition of done

A production change is complete when:

1. The system boundary accepts valid input and rejects malformed/unauthorized input.
2. Cancellation, timeout, and persistence behavior are defined where applicable.
3. A focused regression test proves the changed non-trivial contract.
4. Typecheck and the relevant focused suites pass.
5. The full test, build, and package gates pass before release.
6. User-visible commands, settings, defaults, or trust semantics are documented.
7. No secret, generated build artifact, or unrelated user change is committed.

## 13. Suggested architectural decision records

The existing Reversa documentation already captures retroactive decisions for Bun, the in-tree renderer, provider adapters, context compaction, executable settings, MCP opt-in, risk-first authorization, persistent orchestration, writer worktrees, memory, sessions, and goals.

Release `0.6.0` merits one additional durable ADR:

**Dynamic Workflows execute approved JavaScript over the production orchestrator.** The ADR should record why Worker + `node:vm` was selected, why it is defense in depth rather than a hard sandbox, why `OrchestratorSession` is reused, why the experimental kernel was not activated, how exact-content approval works, and why structural limits remain constants.

This is the only new ADR clearly justified by the release. Other refactors should earn an ADR only when they change a durable architectural decision.

## 14. Release checklist

### Code and contracts

- Version is updated once and lockfile/package metadata agree.
- New settings have defaults, runtime validation, scope rules, and docs.
- New tools/commands appear in registries, help, modes/profiles, and tests.
- Persisted schema changes have version/migration/recovery behavior.
- Provider changes include provider-specific fixtures.

### Verification

- `bun run typecheck` passes.
- `bun test` passes with skips understood.
- `bun run test:coverage` passes and uploads LCOV.
- `bun run build` passes.
- `bun run pack:check` passes as an installed consumer.
- Website lint/test/build passes when website/shared metadata changed.
- Manual TUI smoke covers startup, one response, one tool approval, cancellation, and terminal restoration.
- Workflow releases additionally smoke saved discovery, approval, a two-phase run, monitor output, stop/restart, and worktree reporting.

### Documentation and delivery

- README and factual report snapshot match the release.
- Trust language accurately distinguishes sandboxing, consent, and tool permissions.
- Changelog/release notes explain user-visible behavior and migration.
- Git tag, npm package, and repository main branch identify the same version.

## 15. Final recommendation

For the next cycle, prioritize **consolidation over breadth**. Dynamic Workflows completes the missing programmable coordination layer. Adding more orchestration primitives immediately would yield less value than making current behavior easier to discover, review, and evolve.

The recommended sequence is:

1. Automate factual documentation drift checks and clarify the experimental kernel.
2. Extract the existing workflow/permission/turn boundaries from the oversized integration roots.
3. Deliver the richer workflow selector/monitor as a focused minor-version UX improvement.
4. Converge persistence paths and strengthen provider contract matrices.

This path protects what is already distinctive—local authority, worktree isolation, recovery, and a first-class TUI—without building another framework beside the one that now works.
