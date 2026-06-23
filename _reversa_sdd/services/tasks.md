# Tasks — Módulo Services

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

### T-SV-01: Auto-Compact 🟢

**Fonte:** `src/services/compact/autoCompact.ts`
**Descrição:** Implementar compactação com threshold, summary prompt e circuit breaker.

**Critério de pronto:**
- Check: contextUsage/contextLimit > threshold
- Compact: envia histórico ao LLM com COMPACT_PROMPT
- Circuit breaker: 3 falhas → disabled
- Integração com boundary markers

**Confiança:** 🟢

---

### T-SV-02: MicroCompact 🟢

**Fonte:** `src/services/compact/autoCompact.ts`
**Descrição:** Implementar truncamento de tool results antigos.

**Critério de pronto:**
- Filtra mensagens role=tool
- Mantém 5 mais recentes
- Substitui content das anteriores por "[truncated]"

**Confiança:** 🟢

---

## Estimativa de Complexidade

| Task | Complexidade | LOC estimado |
|------|-------------|--------------|
| T-SV-01 | Média | ~60 |
| T-SV-02 | Baixa | ~25 |
| **Total** | — | **~85** |
