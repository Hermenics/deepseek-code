# ADR 003 — Use direct provider adapters, not the retired proxy/OAuth layer

**Status:** accepted. **Evidence:** removal commit `67a8690`; current `src/agent/providers/`. **Confidence:** 🟢

## Decision

Connect the agent directly to DeepSeek, Bedrock, Vertex, and local provider adapters. The former proxy and OAuth modules are not part of the current architecture.

## Alternatives considered

- Retain a common local proxy and OAuth mediation service.
- Support only one hosted provider.

## Consequences

- Provider-specific streaming, context, authentication, and tool conventions are handled at the adapter boundary.
- No proxy service needs to be deployed or documented as a runtime dependency.

