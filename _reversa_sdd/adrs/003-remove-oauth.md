# ADR-003: Remove OAuth, Keep Proxy Architecture

> Status: ACCEPTED  
> Date: 2026 (commit `e09a92b`)  
> Confidence: 🟢 CONFIRMED

## Context

The project originally used OAuth to authenticate with DeepSeek's browser-based API. This involved:
- OAuth token management
- A proxy server translating API formats
- Text-based tool call parsing fallback
- Complex conditional logic in the agent based on auth mode

Over time, the OAuth flow became fragile and was temporarily disabled (commit `f9bfa10`), then fully removed.

## Decision

Remove all OAuth authentication code. Consolidate around 4 clean provider types: `deepseek` (API key), `bedrock` (AWS), `vertex` (GCP), `local` (Ollama/LM Studio). The proxy architecture is retained for the browser-based DeepSeek integration but decoupled from OAuth.

## Rationale

1. OAuth flow was unreliable (infinite blank TUI bug — commit `69ad24e`)
2. DeepSeek released proper API keys, making OAuth unnecessary
3. Proxy architecture still useful for browser-based access (Playwright page pool)
4. Simplifies agent initialization — no more conditional imports and fallback chains
5. Consolidates `ProviderConfig` into a shared `types/provider.ts` module

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Fix OAuth and keep it | Too fragile, upstream API changes frequently, proper API keys available |
| Remove proxy entirely | Still needed for browser-based provider (DeepSeek doesn't have full API parity) |
| Keep OAuth as optional fallback | Dead code maintenance burden, confusing for users |

## Consequences

- **Positive:** ~150 lines removed from agent.ts, simpler initialization
- **Positive:** Single `ProviderConfig` type shared across all modules
- **Positive:** No more OAuth-specific bug surface area
- **Negative:** Users relying on browser-based auth (no API key) need the proxy path
- **Migration:** OAuth provider config no longer accepted — users must use API key or cloud credentials
