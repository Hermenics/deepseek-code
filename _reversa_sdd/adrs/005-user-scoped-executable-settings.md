# ADR 005 — Keep executable configuration user-scoped

**Status:** accepted. **Evidence:** `src/settings/repository.ts`, hooks and MCP implementation. **Confidence:** 🟢

## Decision

Project and local settings may describe preferences but cannot activate executable hooks, LSP commands, project MCP servers, or default `auto` mode. Those capabilities require user-scope consent.

## Alternatives considered

- Treat checked-in project configuration as executable authority.
- Disable all project configuration, including benign preferences.

## Consequences

- Cloning a repository does not silently authorize local command execution.
- Operators must explicitly opt in to project tooling they trust.

