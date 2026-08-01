# DeepSeek Code — reverse-engineered documentation

This documentation was fully re-extracted on **2026-08-01** from source version **v0.4.15** (`69ccd33`). It supersedes the prior 2026-07-01 output.

## Start here

- [Architecture](architecture.md), [system context](c4-context.md), [containers](c4-containers.md), and [components](c4-components.md)
- [Domain model](domain.md), [state machines](state-machines.md), and [authority model](permissions.md)
- [Source analysis](code-analysis.md), [inventory](inventory.md), [dependencies](dependencies.md), and [data dictionary](data-dictionary.md)
- [Retroactive decisions](adrs/) and [flowcharts](flowcharts/)
- [Module specs](agent/), [traceability](traceability/code-spec-matrix.md), and [core user stories](user-stories/core-workflows.md)

## Scope notes

This is a local Bun terminal application. It has no current Hono/Playwright browser proxy, public HTTP API, relational database, or `src/state/` application store. The 18 documented units map the current source modules. 🟢
