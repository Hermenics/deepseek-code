# Matriz de Impacto — Spec × Componente

> Gerado pelo Arquiteto (Reversa) em 2026-06-23
> Use para avaliar blast radius de mudanças e priorizar testes de regressão.

## Legenda

- **P** = Primário (componente implementa diretamente a regra)
- **S** = Secundário (componente é afetado indiretamente)
- **—** = Sem impacto

## Regras de Negócio × Componentes

| Regra | Agent | Tools | UI | Proxy | Settings | Persistence | State |
|-------|-------|-------|-----|-------|----------|-------------|-------|
| **S1** Path sandbox | S | P | — | — | — | — | — |
| **S2** Sensitive file block | S | P | — | — | — | — | — |
| **S3** Destructive cmd detect | S | P | — | — | — | — | — |
| **S4** SSRF protection | — | P | — | — | — | — | — |
| **S5** Anti-ReDoS glob | — | P | — | — | — | — | — |
| **S6** Permission system | P | S | S | — | P | — | — |
| **S7** Hook execution | P | S | — | — | P | — | — |
| **S8** MCP env protection | P | — | — | — | P | — | — |
| **S9** Audit logging | P | — | — | — | — | P | — |
| **S10** Session isolation | P | — | — | — | — | P | — |
| **C1** Auto-compact 85% | P | — | S | — | S | — | S |
| **C2** Micro-compact | P | — | — | — | — | — | — |
| **C3** Compact boundary | P | — | — | — | — | — | S |
| **C4** Max 50 sessions | — | — | — | — | — | P | — |
| **C5** Max 20 checkpoints | — | — | — | — | — | P | — |
| **C6** History 500 msgs | — | — | — | — | — | P | — |
| **M1** Plan mode (read-only) | P | S | P | — | S | — | P |
| **M2** Build mode (confirm) | P | S | P | — | S | — | P |
| **M3** Auto mode (unrestricted) | P | S | P | — | S | — | P |
| **M4** Mode switching | P | — | P | — | — | — | P |
| **M5** Mode-based tool filter | P | P | — | — | — | — | — |
| **T1** WriteFile LCS diff | — | P | S | — | — | — | — |
| **T2** PatchFile single replace | — | P | S | — | — | — | — |
| **T3** Shell execa | — | P | — | — | — | — | — |
| **T4** SubAgent loop | P | P | — | — | — | — | — |
| **T5** Git operations | — | P | — | — | — | — | — |
| **T6** WebFetch HTML strip | — | P | — | — | — | — | — |
| **T7** Todo CRUD | — | P | S | — | — | — | S |
| **T8** ReadFile/ReadFolder | — | P | — | — | — | — | — |
| **T9** Grep/Glob | — | P | — | — | — | — | — |
| **P1** DeepSeek native | P | — | — | — | S | — | — |
| **P2** AWS Bedrock SigV4 | P | — | — | — | S | — | — |
| **P3** Vertex OAuth2 | P | — | — | — | S | — | — |
| **P4** Local (Ollama) | P | — | — | — | S | — | — |
| **P5** Proxy (Playwright) | P | — | — | P | S | — | — |
| **P6** Model resolution | P | — | — | P | — | — | — |
| **X1** Page pool warmup | — | — | — | P | — | — | — |
| **X2** SSE streaming parse | — | — | — | P | — | — | — |
| **X3** Robust JSON parse | — | — | — | P | — | — | — |

## Análise de Blast Radius

| Componente | Regras Primárias | Regras Secundárias | Risco de mudança |
|------------|-----------------|-------------------|------------------|
| **Agent** | 12 | 4 | 🔴 Alto — core loop, impacta quase tudo |
| **Tools** | 16 | 5 | 🔴 Alto — maior superfície de regras |
| **UI** | 3 | 6 | 🟡 Médio — afeta UX mas não lógica core |
| **Proxy** | 6 | 0 | 🟡 Médio — isolado mas complexo internamente |
| **Settings** | 3 | 10 | 🟡 Médio — configura muitos comportamentos |
| **Persistence** | 5 | 0 | 🟢 Baixo — simples CRUD, bem isolado |
| **State** | 0 | 6 | 🟢 Baixo — pub/sub passivo |

## Dependências Críticas (Chains)

```
Permission Rule → Settings → Agent → Tools (chain de autorização)
Mode Switch → State → UI + Agent + Tools (chain de modo)
Auto-compact → Agent → Persistence (chain de contexto)
Provider Config → Settings → Agent → Proxy|API (chain de provider)
Hook Config → Settings → Agent → Shell (chain de hooks)
```

## Recomendações para Testes de Regressão

1. **Mudanças em Agent**: testar modos, compact, permissions, providers
2. **Mudanças em Tools**: testar path safety, tool-specific behavior, permission check
3. **Mudanças em Settings**: testar merge hierarchy, permission resolution, hook loading
4. **Mudanças em Proxy**: testar SSE parsing, page pool, model resolution (isolado)
5. **Mudanças em UI**: testar mode display, input handling, tool output rendering
