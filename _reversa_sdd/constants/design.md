# Design — Módulo Constants

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Organização

```
src/constants/
├── product.ts   — PRODUCT_NAME, PRODUCT_CLI_NAME, CONFIG_DIR
├── tools.ts     — SHELL_OUTPUT_MAX_CHARS, SHELL_TIMEOUT_MS, GREP_MAX_LINES, GLOB_MAX_FILES, SUBAGENT_MAX_ITERATIONS
├── agent.ts     — UNDO_STACK_MAX, CONTEXT_COMPACT_THRESHOLD, MICRO_COMPACT_KEEP_LAST, CHECKPOINT_MAX
└── ui.ts        — DIFF_MAX_LINES
```

## Decisões de Design

| Decisão | Rationale | Confiança |
|---------|-----------|-----------|
| Arquivos separados por domínio | Import seletivo — não carrega constants de tools ao usar apenas product | 🟢 |
| `as const` em tudo | Type narrowing: literal types ao invés de `string`/`number` genérico | 🟡 |
| Sem config runtime | São constantes de compilação, não configuráveis pelo usuário | 🟢 |
