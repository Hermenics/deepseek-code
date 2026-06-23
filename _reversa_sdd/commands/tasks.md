# Tasks — Módulo Commands

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Tasks de Reimplementação

### T-CM-01: Command Interface + Dispatcher 🟢

**Fonte:** `src/commands/` (padrão geral)
**Descrição:** Implementar interface Command e dispatcher que resolve por name/alias.

**Critério de pronto:**
- Interface: { name, aliases, parse(args) → CommandResult }
- Dispatcher: extrai `/nome args` do input, lookup, invoca parse
- Unknown command retorna erro formatado

**Confiança:** 🟢

---

### T-CM-02: /model + /models 🟢

**Fonte:** `src/commands/model/index.ts`
**Descrição:** Trocar modelo ativo e listar disponíveis.

**Critério de pronto:**
- `/model <name>` muda model no state
- `/model` sem arg lista modelos por provider
- `/models` lista completa com pricing info

**Confiança:** 🟢

---

### T-CM-03: /clear 🟢

**Fonte:** `src/commands/clear/index.ts`
**Descrição:** Limpar histórico de mensagens.

**Critério de pronto:**
- Remove todas as mensagens exceto system prompt
- Remove compact boundaries
- Reseta tokenCount no state

**Confiança:** 🟢

---

### T-CM-04: /compact 🟢

**Fonte:** `src/commands/compact/index.ts`
**Descrição:** Acionar compactação manual.

**Critério de pronto:**
- Dispara agent.compact() independente do threshold
- Retorna confirmação com tokens antes/depois

**Confiança:** 🟢

---

### T-CM-05: /plan + /review 🟢

**Fonte:** `src/commands/plan/index.ts`, `src/commands/review/index.ts`
**Descrição:** Mudar para modo Plan ou iniciar Review.

**Critério de pronto:**
- `/plan` seta mode para Plan no state
- `/review` inicia análise do último diff/commit

**Confiança:** 🟢

---

### T-CM-06: /agent + /agents 🟢

**Fonte:** `src/commands/agent/index.ts`
**Descrição:** Carregar/descarregar agentes custom.

**Critério de pronto:**
- `/agent nome` carrega JSON e aplica (model, prompt, tools)
- `/agent` sem arg descarrega ativo
- `/agents` lista disponíveis (local + global)

**Confiança:** 🟢

---

### T-CM-07: /checkpoint 🟢

**Fonte:** `src/commands/checkpoint/index.ts`
**Descrição:** Save/list/restore de checkpoints.

**Critério de pronto:**
- `/checkpoint save [label]` cria snapshot
- `/checkpoint list` mostra ID, label, data
- `/checkpoint restore <id>` restaura estado

**Confiança:** 🟢

---

### T-CM-08: /undo 🟢

**Fonte:** `src/commands/undo/index.ts`
**Descrição:** Desfazer última escrita.

**Critério de pronto:**
- Pop do undoStack, restaura arquivo
- Informa "nothing to undo" se stack vazio

**Confiança:** 🟢

---

### T-CM-09: /vim 🟢

**Fonte:** `src/commands/vim/index.ts`
**Descrição:** Toggle vim mode no input.

**Critério de pronto:**
- Alterna flag vim no state
- Informa novo estado (on/off)

**Confiança:** 🟢

---

### T-CM-10: Demais Commands 🟢

**Fonte:** Vários em `src/commands/`
**Descrição:** Implementar: /help, /quit, /theme, /language, /sessions, /retry, /cost, /files, /tools, /system, /permissions, /msg, /stats.

**Critério de pronto:**
- Cada um retorna output formatado correto
- /quit encerra processo com code 0
- /retry re-envia última mensagem ao LLM
- /msg injeta nota no contexto sem enviar ao LLM imediatamente

**Confiança:** 🟢

---

## Estimativa de Complexidade

| Task | Complexidade | LOC estimado |
|------|-------------|--------------|
| T-CM-01 | Baixa | ~40 |
| T-CM-02 | Baixa | ~35 |
| T-CM-03 | Baixa | ~15 |
| T-CM-04 | Baixa | ~15 |
| T-CM-05 | Baixa | ~30 |
| T-CM-06 | Média | ~50 |
| T-CM-07 | Média | ~60 |
| T-CM-08 | Baixa | ~15 |
| T-CM-09 | Baixa | ~10 |
| T-CM-10 | Média | ~180 |
| **Total** | — | **~450** |
