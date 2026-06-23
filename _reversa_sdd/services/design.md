# Design — Módulo Services

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Componentes

### 1. Auto-Compact (`compact/autoCompact.ts`) 🟢

**State:**
- `failCount: number` — contador de falhas consecutivas
- `disabled: boolean` — circuit breaker ativo

**Fluxo:**
```
shouldAutoCompact(contextUsage, contextLimit, threshold):
  se disabled → return false
  se contextUsage / contextLimit > threshold → return true
  return false

doCompact(messages, llmClient):
  try:
    summary = await llmClient.chat([
      { role: "system", content: COMPACT_PROMPT },
      ...messages
    ])
    failCount = 0
    return { summary, boundary: createBoundaryMarker() }
  catch:
    failCount++
    se failCount >= 3 → disabled = true
    throw
```

**COMPACT_PROMPT:** Instrui o LLM a sumarizar o histórico preservando: decisões tomadas, arquivos modificados, estado atual do trabalho. 🟡

### 2. MicroCompact 🟢

**Fluxo:**
```
microCompact(messages):
  toolResults = messages.filter(m => m.role === "tool")
  se toolResults.length <= 5 → return messages (unchanged)
  
  toTruncate = toolResults.slice(0, -5)
  para cada msg em toTruncate:
    msg.content = "[truncated]"
  return messages
```

### 3. MCP Re-export 🟢

Re-export de `src/agent/mcp.ts` para acesso via services layer. Sem lógica adicional.

---

## Decisões de Design

| Decisão | Rationale | Confiança |
|---------|-----------|-----------|
| Circuit breaker (3 falhas) | Evita loop infinito se LLM consistentemente falha ao sumarizar | 🟢 |
| MicroCompact antes de Auto | Libera tokens baratos (truncate) antes de chamar LLM (caro) | 🟢 |
| "[truncated]" como placeholder | LLM sabe que havia conteúdo ali sem consumir tokens | 🟢 |
