# Requirements — Módulo Commands

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Visão Geral

O módulo **Commands** implementa os 22 slash commands disponíveis na CLI interativa, cada um como módulo independente com interface padronizada.

**Caminho:** `src/commands/`

---

## Requisitos Funcionais

### RF-01: Interface Padronizada 🟢

**Prioridade:** Must
**Descrição:** Cada command exporta `{ name, aliases, parse(args): CommandResult }`.

**Critérios de Aceitação:**
- Dado que o usuário digita `/nome`, quando o input é processado, então o command correspondente é identificado por name ou alias
- Dado que `parse(args)` é chamado, quando processa, então retorna resultado tipado

### RF-02: /model — Troca de Modelo 🟢

**Prioridade:** Must
**Descrição:** Permite trocar o modelo LLM ativo durante a sessão.

**Critérios de Aceitação:**
- Dado `/model deepseek-reasoner`, quando executa, então o modelo ativo muda para deepseek-reasoner
- Dado `/model` sem argumento, quando executa, então lista modelos disponíveis

### RF-03: /clear — Limpar Histórico 🟢

**Prioridade:** Must
**Descrição:** Limpa o histórico de mensagens da sessão atual.

**Critérios de Aceitação:**
- Dado `/clear`, quando executa, então messages é resetado (mantém system prompt)
- Dado que existem compact boundaries, quando clear roda, então são removidos

### RF-04: /compact — Compactação Manual 🟢

**Prioridade:** Must
**Descrição:** Aciona compactação de contexto manualmente.

**Critérios de Aceitação:**
- Dado `/compact`, quando executa, então o agente executa compact independente do threshold

### RF-05: /plan e /review — Modos Especiais 🟢

**Prioridade:** Should
**Descrição:** Ativa modos plan (read-only) ou review.

**Critérios de Aceitação:**
- Dado `/plan`, quando executa, então interaction mode muda para Plan
- Dado `/review`, quando executa, então inicia análise do último diff/commit

### RF-06: /agent — Agentes Custom 🟢

**Prioridade:** Should
**Descrição:** Carrega ou descarrega um agente custom.

**Critérios de Aceitação:**
- Dado `/agent nome`, quando executa, então carrega o JSON de config e aplica
- Dado `/agent` sem argumento, quando executa, então descarrega o agente ativo

### RF-07: /vim — Toggle Vim Mode 🟢

**Prioridade:** Could
**Descrição:** Ativa/desativa vim keybindings no InputBox.

**Critérios de Aceitação:**
- Dado `/vim`, quando executa, então alterna estado vim (on/off)

### RF-08: /checkpoint — Snapshots 🟢

**Prioridade:** Should
**Descrição:** Salva, lista ou restaura checkpoints.

**Critérios de Aceitação:**
- Dado `/checkpoint save [label]`, quando executa, então cria snapshot
- Dado `/checkpoint list`, quando executa, então lista checkpoints com ID e label
- Dado `/checkpoint restore [id]`, quando executa, então restaura estado

### RF-09: /sessions — Histórico de Sessões 🟢

**Prioridade:** Should
**Descrição:** Lista e permite retomar sessões anteriores.

**Critérios de Aceitação:**
- Dado `/sessions`, quando executa, então lista sessões por data com ID e cwd

### RF-10: /undo — Desfazer Escrita 🟢

**Prioridade:** Should
**Descrição:** Restaura último arquivo escrito pelo agente.

**Critérios de Aceitação:**
- Dado `/undo`, quando executa e stack não vazio, então restaura arquivo anterior
- Dado `/undo` com stack vazio, quando executa, então informa "nothing to undo"

### RF-11: /cost — Estimativa de Custo 🟢

**Prioridade:** Could
**Descrição:** Mostra custo acumulado da sessão.

**Critérios de Aceitação:**
- Dado `/cost`, quando executa, então mostra input/output/cached tokens e custo em USD

### RF-12: /permissions — Regras Ativas 🟢

**Prioridade:** Could
**Descrição:** Mostra permissões allow/deny configuradas.

**Critérios de Aceitação:**
- Dado `/permissions`, quando executa, então lista todas as rules ativas com source (user/project/local)

### RF-13: Demais Commands 🟢

**Prioridade:** Could
**Descrição:** /help, /quit, /theme, /language, /retry, /files, /tools, /system, /msg, /stats, /models, /agents.

**Critérios de Aceitação:**
- Cada command retorna output formatado apropriado ao seu propósito

---

## MoSCoW Summary

| Prioridade | Commands |
|------------|----------|
| **Must** | /model, /clear, /compact, /quit |
| **Should** | /plan, /review, /agent, /checkpoint, /sessions, /undo |
| **Could** | /vim, /cost, /permissions, /help, /theme, /language, /retry, /files, /tools, /system, /msg, /stats |

---

## Dependências

| Depende de | Motivo |
|------------|--------|
| `agent` | Acesso a métodos compact(), undo(), saveCheckpoint() |
| `state` | Leitura de estado (model, provider, tokenCount) |
| `settings` | Leitura de configurações e permissions |
| `ui` | Atualiza interaction mode e vim state |
