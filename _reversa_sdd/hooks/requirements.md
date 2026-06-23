# Requirements — Módulo Hooks

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Visão Geral

O módulo **Hooks** implementa o sistema extensível de interceptação de tool use e session lifecycle via shell commands externos.

**Caminho:** `src/hooks/`

---

## Requisitos Funcionais

### RF-01: PreToolUse Hook 🟢

**Prioridade:** Must
**Descrição:** Executar hook antes de uma tool, podendo bloquear ou modificar input.

**Critérios de Aceitação:**
- Dado hook configurado para "Shell", quando shell tool é invocada, então hook executa antes
- Dado que hook retorna `{"action": "block", "reason": "..."}`, quando processado, então tool NÃO executa
- Dado que hook retorna `{"action": "allow"}`, quando processado, então tool executa normalmente
- Dado matcher "*" (catch-all), quando qualquer tool é invocada, então hook executa

### RF-02: PostToolUse Hook 🟢

**Prioridade:** Should
**Descrição:** Executar hook após uma tool completar (fire-and-forget).

**Critérios de Aceitação:**
- Dado hook PostToolUse configurado, quando tool completa, então hook executa com resultado
- Dado que hook falha, quando timeout ou crash, então NÃO afeta o fluxo principal

### RF-03: SessionStart Hook 🟢

**Prioridade:** Should
**Descrição:** Executar hook ao iniciar uma sessão.

**Critérios de Aceitação:**
- Dado hook SessionStart configurado, quando agente inicializa, então hook executa
- Dado que hook retorna dados, quando processado, então dados podem ser injetados no contexto

### RF-04: Matcher System 🟢

**Prioridade:** Must
**Descrição:** Matchers determinam quais tools ativam quais hooks.

**Critérios de Aceitação:**
- Dado matcher "Shell", quando shell tool é chamada, então hook ativa
- Dado matcher "WriteFile|PatchFile", quando pipe-separated, então ambas tools ativam
- Dado matcher "*", quando qualquer tool é chamada, então hook ativa

### RF-05: Segurança — User-Level Only 🟢

**Prioridade:** Must
**Descrição:** Hooks só são carregados de settings user-level.

**Critérios de Aceitação:**
- Dado hooks em `~/.deepseek/settings.json`, quando carregados, então são aceitos
- Dado hooks em `.deepseek/settings.json` (project), quando settings são loaded, então hooks são stripados
- Dado hooks em `.deepseek/settings.local.json`, quando settings são loaded, então hooks são stripados

---

## Requisitos Não Funcionais

| # | Categoria | Requisito | Confiança |
|---|-----------|-----------|-----------|
| RNF-01 | Segurança | Hooks carregados APENAS de user-level settings | 🟢 |
| RNF-02 | Disponibilidade | Timeout configurável (default 30s) | 🟢 |
| RNF-03 | Disponibilidade | PostToolUse é fire-and-forget (falha não bloqueia) | 🟢 |

---

## Dependências

| Depende de | Motivo |
|------------|--------|
| `settings` | Carregamento e filtragem de hooks config |
| `agent` | Integração no checkAndExecuteTool |
