# ADR 007 — Authorize tools through layered, risk-first checks

**Status:** accepted. **Evidence:** `agent.ts`, `permissions/`, `tools/file/`. **Confidence:** 🟢

## Decision

Authorize every tool call through mode gating, filesystem safety, risk classification, configured permission rules, hooks, and confirmation. Deny rules take precedence; high-risk confirmation is mandatory.

## Alternatives considered

- A single allowlist at prompt construction time.
- Fully unrestricted execution in Build mode.

## Consequences

- Authorization remains enforceable even if tool calls are produced unexpectedly.
- A tool can be permitted by mode yet still require confirmation or be denied on another layer.

