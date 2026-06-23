# Requirements — Módulo Ink (Fork)

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Visão Geral

O módulo **Ink** é um fork customizado do framework Ink — um React renderer para terminal (TUI). Fornece componentes primitivos, layout engine (Yoga/Flexbox), event system, ANSI parsing e rendering pipeline.

**Caminho:** `src/ink/`

---

## Requisitos Funcionais

### RF-01: React Reconciler Customizado 🟢

**Prioridade:** Must
**Descrição:** Reconciler React que traduz componentes em nós de layout para terminal.

**Critérios de Aceitação:**
- Dado componentes React (Box, Text), quando reconciler processa, então cria tree de nós Yoga
- Dado atualização de props, quando reconciler reconcilia, então aplica diff minimal

### RF-02: Layout Engine (Yoga/Flexbox) 🟢

**Prioridade:** Must
**Descrição:** Layout via Yoga com bindings TypeScript puros (sem native addons).

**Critérios de Aceitação:**
- Dado Box com flexDirection, width, padding, quando layout calcula, então posiciona children corretamente
- Dado terminal resize, quando dimensions mudam, então re-calcula layout

### RF-03: Componentes Primitivos 🟢

**Prioridade:** Must
**Descrição:** Box, Text, Button, ScrollBox, Link, Newline, Spacer, RawAnsi, AlternateScreen, NoSelect, ErrorOverview.

**Critérios de Aceitação:**
- Box: container com flexbox props (direction, wrap, align, justify, padding, margin, border)
- Text: renderiza string com ANSI styles (bold, italic, color, bg)
- ScrollBox: scroll vertical com viewport
- Button: focusable com onClick handler

### RF-04: Event System 🟢

**Prioridade:** Must
**Descrição:** Sistema de eventos para Click, Focus, Keyboard, Paste, Resize, TerminalFocus.

**Critérios de Aceitação:**
- Dado click no terminal, quando event dispatcha, então hit-test identifica componente alvo
- Dado keypress, quando event dispatcha, então componente focused recebe
- Dado resize do terminal, quando detectado, então re-render com novas dimensions

### RF-05: Terminal I/O (ANSI Parser) 🟢

**Prioridade:** Must
**Descrição:** Parser e tokenizer completo de sequências ANSI/SGR/CSI/OSC/DEC/ESC.

**Critérios de Aceitação:**
- Dado input com escape sequences, quando parsed, então tokens são classificados corretamente
- Dado ANSI colors (16, 256, truecolor), quando processados, então renderizam corretamente
- Dado mouse tracking sequences, quando recebidos, então geram eventos de click

### RF-06: Rendering Pipeline 🟢

**Prioridade:** Must
**Descrição:** Pipeline: reconciler → renderer → node-to-output → screen write.

**Critérios de Aceitação:**
- Dado tree de nós, quando render executa, então produz buffer de strings ANSI
- Dado buffer anterior e atual, quando diff é calculado, então só linhas alteradas são re-escritas (log-update)

### RF-07: Bidirectional Text (Bidi) 🟢

**Prioridade:** Could
**Descrição:** Suporte a textos RTL e bidirecionais.

**Critérios de Aceitação:**
- Dado texto com caracteres árabes/hebraicos, quando renderizado, então direção é resolvida corretamente

### RF-08: East Asian Width 🟢

**Prioridade:** Should
**Descrição:** Detecção de largura de caracteres CJK (full-width vs half-width).

**Critérios de Aceitação:**
- Dado caractere CJK, quando width é calculado, então conta como 2 colunas

---

## Requisitos Não Funcionais

| # | Categoria | Requisito | Confiança |
|---|-----------|-----------|-----------|
| RNF-01 | Performance | Incremental render — só re-escreve linhas alteradas | 🟢 |
| RNF-02 | Performance | Yoga layout bindings TS puros (sem native addons) | 🟢 |
| RNF-03 | Compatibilidade | Suporte a terminais: iTerm2, Terminal.app, GNOME Terminal, Windows Terminal | 🟡 |
| RNF-04 | Performance | Mouse tracking sem polling (event-driven) | 🟢 |

---

## MoSCoW Summary

| Prioridade | Requisitos |
|------------|------------|
| **Must** | RF-01 a RF-06 (reconciler, layout, components, events, ANSI, render pipeline) |
| **Should** | RF-08 (East Asian Width) |
| **Could** | RF-07 (Bidi) |

---

## Dependências

| Depende de | Motivo |
|------------|--------|
| `react` (19) | Reconciler API |
| `react-reconciler` | Host config implementation |
| `yoga-layout` (TS port) | Flexbox calculations |
| `bidi-js` | Bidirectional text resolution |
