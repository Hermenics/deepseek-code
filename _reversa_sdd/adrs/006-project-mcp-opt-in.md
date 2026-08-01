# ADR 006 — Make project MCP servers opt-in

**Status:** accepted. **Evidence:** commit `440922d`, `src/agent/mcp.ts`. **Confidence:** 🟢

## Decision

Leave project `.deepseek/mcp.json` definitions inactive until the operator enables the user-scoped MCP flag and restarts the agent. Spawn MCP stdio children with a minimal environment.

## Alternatives considered

- Auto-load any repository MCP definition.
- Disallow project MCP entirely.

## Consequences

- Projects can declare integrations without gaining automatic local execution rights.
- Discovery is less frictionless but the authority boundary is explicit.

