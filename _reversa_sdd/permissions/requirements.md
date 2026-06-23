# Requirements — Módulo Permissions

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Visão Geral

O módulo **Permissions** implementa o sistema de regras allow/deny com glob matching iterativo para controle de acesso a tools.

**Caminho:** `src/permissions/`

---

## Requisitos Funcionais

### RF-01: Permission Resolution 🟢

**Prioridade:** Must
**Descrição:** Resolver se uma tool call é permitida baseado em deny/allow rules.

**Critérios de Aceitação:**
- Dado que deny rules existem e match → bloqueia
- Dado que deny rules existem e NÃO match → prossegue
- Dado que allow rules existem e match → permite
- Dado que allow rules existem e NÃO match → ask (prompt user)
- Dado que nenhuma rule existe → ask

### RF-02: Glob Matching (Anti-ReDoS) 🟢

**Prioridade:** Must
**Descrição:** Matching de patterns com wildcards usando algoritmo iterativo.

**Critérios de Aceitação:**
- Dado pattern `Shell(git *)`, quando command é `git push`, então match
- Dado pattern com > 10 wildcards, quando processado, então rejeitado
- Dado input adversarial (ReDoS attempt), quando matching executa, então completa em tempo linear
- Matching é case-insensitive

### RF-03: Content Matching por Tool 🟢

**Prioridade:** Must
**Descrição:** O campo comparado depende da tool.

**Critérios de Aceitação:**
- `shell` → match no campo `command`
- `read_file/write_file/patch_file` → match no campo `path`
- `web_fetch` → match no campo `url`
- `grep` → match no campo `pattern`

### RF-04: Rule Format 🟢

**Prioridade:** Must
**Descrição:** Rules são strings no formato `ToolName(pattern)`.

**Critérios de Aceitação:**
- Dado `Shell(git *)`, quando parsed, então toolName="shell", pattern="git *"
- Dado `WriteFile(src/*)`, quando parsed, então toolName="write_file", pattern="src/*"
- Dado `*` sozinho, quando parsed, então match-all tools e patterns

---

## Requisitos Não Funcionais

| # | Categoria | Requisito | Confiança |
|---|-----------|-----------|-----------|
| RNF-01 | Segurança | Algoritmo iterativo (imune a ReDoS) | 🟢 |
| RNF-02 | Segurança | Max 10 wildcards por pattern | 🟢 |
| RNF-03 | Performance | Matching em O(n*m) worst case (não exponencial) | 🟢 |

---

## Dependências

| Depende de | Motivo |
|------------|--------|
| `settings` | Source das rules (allow[] e deny[]) |
