# Requirements — Módulo Constants

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Visão Geral

O módulo **Constants** define constantes globais organizadas por domínio: product identity, tool limits, UI defaults e agent configuration.

**Caminho:** `src/constants/`

---

## Requisitos Funcionais

### RF-01: Product Constants 🟢

**Prioridade:** Must
**Descrição:** Identidade do produto.

**Valores:**
- `PRODUCT_NAME` = "DeepSeek Code"
- `PRODUCT_CLI_NAME` = "deepseek"
- `CONFIG_DIR` = ".deepseek"

### RF-02: Tool Constants 🟢

**Prioridade:** Must
**Descrição:** Limites operacionais das tools.

**Valores:**
- `SHELL_OUTPUT_MAX_CHARS` = 50,000
- `SHELL_TIMEOUT_MS` = 30,000
- `GREP_MAX_LINES` = 200
- `GLOB_MAX_FILES` = 500
- `SUBAGENT_MAX_ITERATIONS` = 15

### RF-03: Agent Constants 🟢

**Prioridade:** Must
**Descrição:** Configurações do agente.

**Valores:**
- `UNDO_STACK_MAX` = 10
- `CONTEXT_COMPACT_THRESHOLD` = 0.85
- `MICRO_COMPACT_KEEP_LAST` = 5
- `CHECKPOINT_MAX` = 20

### RF-04: UI Constants 🟢

**Prioridade:** Should
**Descrição:** Limites visuais.

**Valores:**
- `DIFF_MAX_LINES` = 50

---

## Dependências

Nenhuma (módulo leaf — importado por todos os outros).
