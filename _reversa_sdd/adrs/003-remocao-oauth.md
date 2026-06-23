# ADR-003: Remoção do OAuth Provider

> Status: Aceito
> Data: 2026-06 (commit mais recente)
> Contexto: commit `e09a92b` — "refactor(agent,tools,ui): remove OAuth code and consolidate provider types"

## Decisão

Remover completamente o provider OAuth do codebase e consolidar os tipos de provider.

## Razão

- OAuth era usado para autenticação via browser no DeepSeek web (proxy approach).
- O proxy server (`providers/proxy/`) substituiu essa funcionalidade de forma mais robusta.
- Código OAuth adicionava complexidade ao agent (fallback logic, conditional imports) sem vantagem sobre o proxy.
- Consolidação simplificou ProviderConfig para 4 tipos claros: deepseek, bedrock, vertex, local.

## Consequências

- ProviderConfig movido de `ui/setup` para `types/provider.ts` (módulo compartilhado).
- Undo stack logic centralizado no pipeline de tool execution.
- hookSessionId adicionado ao Agent para tracking consistente.
- ApiKeySetup simplificado (menos opções de provider na UI).

🟢 CONFIRMADO
