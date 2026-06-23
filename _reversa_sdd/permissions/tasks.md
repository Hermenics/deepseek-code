# Tasks — Módulo Permissions

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

### T-PM-01: Rule Parser 🟢

**Fonte:** `src/permissions/` (parser logic)
**Descrição:** Implementar parsing de `ToolName(pattern)` string.

**Critério de pronto:**
- Parse "Shell(git *)" → { toolName: "shell", pattern: "git *" }
- Parse "*" → match-all
- Valida formato (erro se malformado)

**Confiança:** 🟢

---

### T-PM-02: Iterative Glob Matcher 🟢

**Fonte:** `src/permissions/matcher.ts`
**Descrição:** Implementar matching iterativo anti-ReDoS.

**Critério de pronto:**
- Dois ponteiros com backtrack em wildcards
- O(n*m) worst case
- Rejeita > 10 wildcards
- Case-insensitive
- Suporta `*` (single segment) e `**` (multi-segment)

**Confiança:** 🟢

---

### T-PM-03: Permission Resolver 🟢

**Fonte:** `src/permissions/` (resolver logic)
**Descrição:** Implementar fluxo deny→allow→ask.

**Critério de pronto:**
- Deny match → DENIED
- Allow match → ALLOWED
- Allow exists but no match → ASK
- No rules → ASK
- Content extraction per tool type

**Confiança:** 🟢

---

## Estimativa de Complexidade

| Task | Complexidade | LOC estimado |
|------|-------------|--------------|
| T-PM-01 | Baixa | ~25 |
| T-PM-02 | Média | ~60 |
| T-PM-03 | Baixa | ~40 |
| **Total** | — | **~125** |
