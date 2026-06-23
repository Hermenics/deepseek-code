# Tasks — Módulo Constants

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

### T-CN-01: Constantes por Domínio 🟢

**Fonte:** `src/constants/`
**Descrição:** Implementar arquivos de constantes: product.ts, tools.ts, agent.ts, ui.ts.

**Critério de pronto:**
- product.ts: PRODUCT_NAME, PRODUCT_CLI_NAME, CONFIG_DIR
- tools.ts: SHELL_OUTPUT_MAX_CHARS, SHELL_TIMEOUT_MS, GREP_MAX_LINES, GLOB_MAX_FILES, SUBAGENT_MAX_ITERATIONS
- agent.ts: UNDO_STACK_MAX, CONTEXT_COMPACT_THRESHOLD, MICRO_COMPACT_KEEP_LAST, CHECKPOINT_MAX
- ui.ts: DIFF_MAX_LINES
- Todos `as const`

**Confiança:** 🟢

---

## Estimativa de Complexidade

| Task | Complexidade | LOC estimado |
|------|-------------|--------------|
| T-CN-01 | Baixa | ~30 |
