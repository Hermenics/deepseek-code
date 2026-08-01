# Settings — technical design

## Interface

`DeepSeekSettings` represents provider, interaction, compaction, permissions/risk, agents, memory, sessions, Git, LSP, MCP, goals, UI and hooks configuration. 🟢

## Main flow

1. Load legacy/default, user, project, and local documents. 🟢
2. Validate each scope and merge recognized keys; selected arrays concatenate/deduplicate. 🟢
3. Strip or warn about executable values outside user scope. 🟢
4. Atomically save validated data and expose snapshot/origin diagnostics. 🟢

## Constraints

Defaults include Build mode, disabled project MCP, five orchestration workers, and three goal continuations. Numeric settings are bounded in validation. 🟢
