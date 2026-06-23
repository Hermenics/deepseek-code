# Tasks — Módulo Hooks

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Tasks de Reimplementação

### T-HK-01: Matcher 🟢

**Fonte:** `src/hooks/matcher.ts`
**Descrição:** Implementar resolução de hooks por tool name e event type.

**Critério de pronto:**
- Lookup por event (PreToolUse, PostToolUse, SessionStart)
- Match: "*" (catch-all) ou pipe-separated tool names
- Retorna array de hooks aplicáveis ordenados por definição

**Confiança:** 🟢

---

### T-HK-02: Executor 🟢

**Fonte:** `src/hooks/executor.ts`
**Descrição:** Implementar execução de hook via child_process.spawn.

**Critério de pronto:**
- Spawn command com env herdado
- Envia JSON context via stdin
- Lê JSON response via stdout
- Timeout configurável (default 30s), kill processo se exceder
- Error handling: timeout/crash → retorna action "allow"

**Confiança:** 🟢

---

### T-HK-03: PreToolUse Integration 🟢

**Fonte:** `src/hooks/` + `src/agent/agent.ts`
**Descrição:** Integrar PreToolUse no fluxo de checkAndExecuteTool.

**Critério de pronto:**
- Antes de executar tool: match hooks → execute sequencialmente
- Se qualquer hook retorna "block" → tool não executa, retorna reason ao LLM
- Se todos retornam "allow" ou timeout → prossegue

**Confiança:** 🟢

---

### T-HK-04: PostToolUse Integration 🟢

**Fonte:** `src/hooks/` + `src/agent/agent.ts`
**Descrição:** Integrar PostToolUse fire-and-forget.

**Critério de pronto:**
- Após tool executar: match hooks → spawn sem await
- Falha não afeta resultado da tool

**Confiança:** 🟢

---

### T-HK-05: SessionStart Integration 🟢

**Fonte:** `src/hooks/` + `src/agent/agent.ts`
**Descrição:** Integrar SessionStart no initialize do agent.

**Critério de pronto:**
- Durante initialize: match SessionStart hooks → execute
- Resultado pode injetar contexto adicional

**Confiança:** 🟢

---

## Estimativa de Complexidade

| Task | Complexidade | LOC estimado |
|------|-------------|--------------|
| T-HK-01 | Baixa | ~30 |
| T-HK-02 | Média | ~60 |
| T-HK-03 | Baixa | ~25 |
| T-HK-04 | Baixa | ~15 |
| T-HK-05 | Baixa | ~15 |
| **Total** | — | **~145** |
