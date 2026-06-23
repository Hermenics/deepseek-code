# Requirements — Módulo Services

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Visão Geral

O módulo **Services** agrupa serviços auxiliares: auto-compact (summary prompt + circuit breaker), MCP re-export e session management.

**Caminho:** `src/services/`

---

## Requisitos Funcionais

### RF-01: Auto-Compact Service 🟢

**Prioridade:** Must
**Descrição:** Compactar contexto automaticamente quando threshold é atingido.

**Critérios de Aceitação:**
- Dado que `contextUsage/contextLimit > 0.85`, quando chamado, então executa compactação
- Dado que compact falha, quando counter atinge 3, então desativa (circuit breaker)
- Dado que compact falha e counter < 3, quando incrementa, então retenta na próxima iteração

### RF-02: MicroCompact 🟢

**Prioridade:** Must
**Descrição:** Truncar tool results antigos para liberar tokens.

**Critérios de Aceitação:**
- Dado mais de 5 tool results no histórico, quando executa, então trunca os anteriores aos últimos 5
- Dado tool result truncado, quando armazenado, então substitui content por "[truncated]"

### RF-03: MCP Service 🟢

**Prioridade:** Should
**Descrição:** Re-export da integração MCP para uso pelo agent.

**Critérios de Aceitação:**
- Dado servidores MCP em settings, quando agent inicializa, então MCP service conecta e lista tools

---

## Dependências

| Depende de | Motivo |
|------------|--------|
| `agent` | Acesso ao histórico de mensagens e LLM client |
| `settings` | Threshold e config de MCP servers |
| `state` | contextUsage e contextLimit |
