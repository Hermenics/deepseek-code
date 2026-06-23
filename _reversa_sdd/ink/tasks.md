# Tasks — Módulo Ink (Fork)

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Tasks de Reimplementação

### T-INK-01: React Reconciler 🟢

**Fonte:** `src/ink/reconciler.ts`
**Descrição:** Implementar host config para react-reconciler que cria InkNodes.

**Critério de pronto:**
- Host config: createInstance, appendChild, removeChild, commitUpdate
- Cada InkNode mapeia para Yoga node
- Suporta functional components e hooks

**Confiança:** 🟢

---

### T-INK-02: Yoga Layout (TS Bindings) 🟢

**Fonte:** `src/ink/native-ts/yoga-layout/`
**Descrição:** Implementar bindings TypeScript puros para Yoga flexbox.

**Critério de pronto:**
- Todas flexbox props: direction, justify, align, wrap, grow, shrink, basis
- Dimensions: width, height, min/max variants
- Spacing: padding, margin (4 lados)
- Position: relative, absolute
- Calculate layout dado container dimensions

**Confiança:** 🟢

---

### T-INK-03: Componentes Primitivos 🟢

**Fonte:** `src/ink/components/`
**Descrição:** Implementar Box, Text, Button, ScrollBox, Link, Newline, Spacer, RawAnsi, AlternateScreen, NoSelect, ErrorOverview.

**Critério de pronto:**
- Box: container com todas as flexbox props + borderStyle
- Text: estilização ANSI (bold, italic, color 16/256/truecolor)
- ScrollBox: viewport com scroll offset
- Button: focusable + onClick
- Link: OSC 8 hyperlink

**Confiança:** 🟢

---

### T-INK-04: Event System 🟢

**Fonte:** `src/ink/events/`
**Descrição:** Implementar dispatcher de eventos com hit-testing.

**Critério de pronto:**
- Keyboard events: bubbling do focused component
- Click events: hit-test por coordenadas (top-down, last match)
- Resize events: re-trigger layout
- Focus management: tab/shift-tab navigation
- Paste events: burst detection

**Confiança:** 🟢

---

### T-INK-05: Terminal I/O Parser 🟢

**Fonte:** `src/ink/termio/`
**Descrição:** Implementar parser/tokenizer ANSI completo.

**Critério de pronto:**
- Tokeniza: PlainText, SGR, CSI, OSC, DEC, ESC
- Mouse tracking: SGR 1006 extended format
- Cursor control sequences
- Color codes: 16, 256, truecolor (parsing e generation)

**Confiança:** 🟢

---

### T-INK-06: Rendering Pipeline 🟢

**Fonte:** `src/ink/renderer.ts`, `render-node-to-output.ts`, `render-border.ts`, `render-to-screen.ts`
**Descrição:** Implementar pipeline completo de node tree → stdout.

**Critério de pronto:**
- Tree traversal → ANSI string buffer
- Border rendering (cli-boxes styles)
- Output buffer → screen write
- Incremental: diff com buffer anterior, só re-escreve linhas alteradas (log-update)

**Confiança:** 🟢

---

### T-INK-07: Character Width 🟢

**Fonte:** `src/ink/termio/` (width detection)
**Descrição:** Implementar detecção de largura de caracteres (East Asian, combining, emoji).

**Critério de pronto:**
- East Asian Width: fullwidth = 2 cols
- Combining characters: 0 width
- Emoji detection via Unicode tables
- Integração com layout calculations

**Confiança:** 🟢

---

### T-INK-08: Bidi Support 🟢

**Fonte:** `src/ink/termio/` (bidi-js integration)
**Descrição:** Implementar suporte a texto bidirecional.

**Critério de pronto:**
- Resolve direção por parágrafo (LTR/RTL)
- Reorder visual de runs mistos
- Integração com Text component

**Confiança:** 🟢

---

## Estimativa de Complexidade

| Task | Complexidade | LOC estimado |
|------|-------------|--------------|
| T-INK-01 | Alta | ~200 |
| T-INK-02 | Muito Alta | ~800 |
| T-INK-03 | Alta | ~400 |
| T-INK-04 | Alta | ~250 |
| T-INK-05 | Alta | ~350 |
| T-INK-06 | Alta | ~300 |
| T-INK-07 | Média | ~100 |
| T-INK-08 | Média | ~80 |
| **Total** | — | **~2480** |

> Nota: Este é o módulo mais complexo do projeto (~130 arquivos no fork). Considerar usar o upstream Ink como base e aplicar patches para as customizações.
