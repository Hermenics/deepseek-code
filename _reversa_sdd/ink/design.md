# Design — Módulo Ink (Fork)

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Arquitetura Interna

```
┌──────────────────────────────────────────────────────┐
│                    Ink Fork                            │
├──────────────────────────────────────────────────────┤
│                                                        │
│  ┌─────────────┐    ┌─────────────┐    ┌──────────┐  │
│  │ Reconciler  │───▶│  Renderer   │───▶│log-update│  │
│  │(react-recon)│    │(node→output)│    │(screen)  │  │
│  └─────────────┘    └──────┬──────┘    └──────────┘  │
│                             │                          │
│                    ┌────────▼────────┐                 │
│                    │  Yoga Layout    │                 │
│                    │  (TS bindings)  │                 │
│                    └─────────────────┘                 │
│                                                        │
│  ┌─────────────────────────────────────────────────┐  │
│  │              Components                          │  │
│  │  Box, Text, Button, ScrollBox, Link, Newline,   │  │
│  │  Spacer, RawAnsi, AlternateScreen, NoSelect,    │  │
│  │  ErrorOverview                                   │  │
│  └─────────────────────────────────────────────────┘  │
│                                                        │
│  ┌─────────────────────────────────────────────────┐  │
│  │              Event System                        │  │
│  │  Click (hit-test), Focus, Keyboard, Paste,      │  │
│  │  Resize, TerminalFocus                          │  │
│  └─────────────────────────────────────────────────┘  │
│                                                        │
│  ┌─────────────────────────────────────────────────┐  │
│  │              Terminal I/O (termio/)              │  │
│  │  ANSI parser/tokenizer, SGR, CSI, OSC, DEC,    │  │
│  │  mouse tracking, cursor control, bidi-js,       │  │
│  │  East Asian width                               │  │
│  └─────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

---

## Rendering Pipeline 🟢

```
1. React reconciler cria/atualiza tree de InkNodes
2. Cada InkNode mapeia para um Yoga node (layout)
3. Yoga calcula positions/dimensions (flexbox)
4. renderer.ts percorre tree:
   - render-node-to-output.ts → converte node em strings ANSI
   - render-border.ts → adiciona bordas (cli-boxes)
5. render-to-screen.ts → buffer final
6. log-update.ts → diff com buffer anterior → escreve apenas linhas alteradas
```

---

## Componentes

### Primitivos 🟢

| Componente | Props principais | Função |
|------------|-----------------|--------|
| Box | flexDirection, width, height, padding, margin, borderStyle | Container flexbox |
| Text | bold, italic, color, bgColor, wrap | Texto estilizado |
| Button | onClick, onFocus | Elemento focusable clicável |
| ScrollBox | height, scrollOffset | Container com scroll vertical |
| Link | url | Texto clicável (OSC 8 hyperlink) |
| Newline | count | Quebras de linha |
| Spacer | — | Flex grow filler |
| RawAnsi | content | Injeta ANSI raw sem processing |
| AlternateScreen | — | Alterna para alternate screen buffer |
| NoSelect | — | Conteúdo não selecionável (mouse) |
| ErrorOverview | error | Exibe erro formatado com stack |

### Event Dispatcher 🟢

**Mecanismo:**
1. stdin em raw mode → lê bytes
2. termio parser → classifica sequências (key, mouse, paste, resize)
3. Dispatcher:
   - Keyboard → componente focused (bubbling)
   - Click → hit-test por coordinates (top-down, last match wins)
   - Resize → re-layout global
   - Paste → componente focused (como keyboard batch)

### Terminal I/O (`termio/`) 🟢

**Parser ANSI:**
- Tokeniza input em: PlainText, SGR (styles), CSI (cursor/mouse), OSC (links), DEC (mode set), ESC (misc)
- Suporte completo a mouse tracking (SGR 1006 extended)

**Output:**
- ANSI color codes: 16-color, 256-color, truecolor (24-bit)
- Cursor control: show/hide, position, save/restore
- Screen: clear, alternate buffer, scroll region

**Character width:**
- East Asian Width detection (fullwidth = 2 cols)
- Combining characters (0 width)
- Emoji width via Unicode tables

---

## Yoga Layout (TS Port) 🟢

**Localização:** `src/ink/native-ts/yoga-layout/`

**Motivação:** Bindings TypeScript puros (sem .node addons) para compatibilidade com Bun e eliminação de problemas de build nativo.

**Suporte flexbox:**
- flexDirection (row, column)
- justifyContent (flex-start, center, flex-end, space-between, space-around)
- alignItems (flex-start, center, flex-end, stretch)
- flexWrap, flexGrow, flexShrink, flexBasis
- width, height, minWidth, minHeight, maxWidth, maxHeight
- padding, margin (top, right, bottom, left)
- position (relative, absolute)
- overflow (hidden, visible, scroll)

---

## Decisões de Design

| Decisão | Rationale | Confiança |
|---------|-----------|-----------|
| Fork do Ink ao invés de usar original | Necessidade de features avançadas: click, mouse, scroll, alternate screen (ADR-002) | 🟢 |
| Yoga bindings em TS puro | Elimina dependência de native addons, funciona em Bun sem problemas | 🟢 |
| log-update (incremental render) | Performance: evita flicker, só re-escreve linhas que mudaram | 🟢 |
| Hit-testing por coordinates | Permite click em componentes específicos (botões, links) | 🟢 |
| bidi-js para RTL | Suporte a idiomas RTL sem complexidade adicional | 🟢 |

---

## Dívida Técnica (DT3)

~130 arquivos no fork sem sync com upstream Ink. Bugs corrigidos upstream podem não estar presentes. Recomendação: cherry-pick periódico de fixes relevantes.
