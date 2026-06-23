# Requirements — Módulo UI

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Visão Geral

O módulo **UI** implementa os componentes de aplicação da interface terminal: App root, input com vim mode, mensagens, status bar, setup e interaction modes.

**Caminho:** `src/ui/`

---

## Requisitos Funcionais

### RF-01: App Component (Root) 🟢

**Prioridade:** Must
**Descrição:** Orquestra o estado visual da aplicação: mensagens, tool status, confirmações, mode switching e session persistence.

**Critérios de Aceitação:**
- Dado que o app monta, quando renderiza, então exibe InputBox + MessageList + StatusBar
- Dado que o agente processa tool, quando status muda, então ToolUseDisplay atualiza
- Dado que uma operação destrutiva é detectada, quando confirmação é necessária, então exibe confirm dialog

### RF-02: InputBox — Editor Multiline 🟢

**Prioridade:** Must
**Descrição:** Editor de texto no terminal com cursor, seleção, kill ring e paste detection.

**Critérios de Aceitação:**
- Dado input de texto, quando o usuário digita, então chars são inseridos na posição do cursor
- Dado Ctrl+A/E, quando pressionado, então cursor move para início/fim da linha
- Dado paste rápido (flood de chars), quando detectado, então insere como bloco (não char a char)
- Dado kill ring (Ctrl+K, Ctrl+Y), quando usado, então funciona como clipboard circular

### RF-03: Vim Mode 🟢

**Prioridade:** Should
**Descrição:** Keybindings vim com Normal, Insert e Visual modes.

**Critérios de Aceitação:**
- Dado vim mode ativo e modo Normal, quando `i` é pressionado, então entra em Insert
- Dado modo Normal, quando motions (w, b, e, 0, $) são usados, então cursor move corretamente
- Dado modo Normal, quando operators (d, c, y) + motion, então executa operação
- Dado modo Visual, quando seleção é feita e operator aplicado, então opera sobre seleção

### RF-04: Interaction Modes 🟢

**Prioridade:** Must
**Descrição:** Ciclo de modos Plan → Build → Auto via Shift+Tab.

**Critérios de Aceitação:**
- Dado Shift+Tab, quando pressionado, então mode avança no ciclo (plan→build→auto→plan)
- Dado mode Plan ativo, quando tool de escrita é chamada, então é bloqueada
- Dado mode Auto, quando qualquer tool é chamada, então executa sem confirmação
- Dado que o modelo tenta ativar Auto, quando processado, então é bloqueado (só user pode)

### RF-05: MessageList 🟢

**Prioridade:** Must
**Descrição:** Renderiza histórico de mensagens com formatação por tipo.

**Critérios de Aceitação:**
- Dado mensagem do user, quando renderizada, então exibe com formatação de user
- Dado mensagem do assistant com markdown, quando renderizada, então formata com syntax highlighting
- Dado thinking/reasoning content, quando presente, então exibe colapsável
- Dado tool result, quando renderizado, então exibe com diff formatting se aplicável

### RF-06: StatusBar 🟢

**Prioridade:** Should
**Descrição:** Barra inferior com model, mode, token count e custo.

**Critérios de Aceitação:**
- Dado estado atual, quando renderiza, então mostra: model | mode | tokens | cost
- Dado que model muda, quando state atualiza, então StatusBar re-renderiza

### RF-07: Ghost Hints 🟢

**Prioridade:** Could
**Descrição:** Autocomplete de commands, history ghost e argument hints.

**Critérios de Aceitação:**
- Dado que o input começa com `/`, quando digitando, então mostra ghost do command mais provável
- Dado input vazio e histórico existe, quando seta para cima, então navega pelo histórico

### RF-08: Setup Flow 🟢

**Prioridade:** Must
**Descrição:** Fluxo de primeira execução (configurar API key e provider).

**Critérios de Aceitação:**
- Dado primeira execução sem config, quando app inicia, então exibe setup wizard
- Dado que API key é inserida, quando validada, então persiste em settings

---

## Requisitos Não Funcionais

| # | Categoria | Requisito | Confiança |
|---|-----------|-----------|-----------|
| RNF-01 | Performance | Re-render incremental (só linhas alteradas via log-update) | 🟢 |
| RNF-02 | Usabilidade | Paste detection para blocos grandes (não char a char) | 🟢 |
| RNF-03 | Usabilidade | Shift+Tab nunca conflita com Tab (indent) | 🟢 |
| RNF-04 | Acessibilidade | Suporte a screen readers via ANSI semantics | 🟡 |

---

## MoSCoW Summary

| Prioridade | Requisitos |
|------------|------------|
| **Must** | RF-01, RF-02, RF-04, RF-05, RF-08 (App, Input, Modes, Messages, Setup) |
| **Should** | RF-03, RF-06 (Vim, StatusBar) |
| **Could** | RF-07 (Ghost Hints) |

---

## Dependências

| Depende de | Motivo |
|------------|--------|
| `ink` | Componentes base (Box, Text, etc.) e render pipeline |
| `agent` | Invocação de run(), undo(), compact() |
| `state` | Estado global (model, mode, tokens) |
| `commands` | Processamento de slash commands |
| `settings` | Configurações de tema e vim |
