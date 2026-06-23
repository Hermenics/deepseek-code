# Design — Módulo UI

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Arquitetura Interna

```
┌─────────────────────────────────────────────────┐
│                    App.tsx                        │
│         (Root component — orquestra tudo)        │
├─────────────────────────────────────────────────┤
│                                                   │
│  ┌────────────┐  ┌────────────┐  ┌───────────┐  │
│  │ MessageList│  │  InputBox  │  │ StatusBar │  │
│  │            │  │            │  │           │  │
│  └────────────┘  └─────┬──────┘  └───────────┘  │
│                         │                         │
│               ┌─────────┼─────────┐              │
│               │         │         │              │
│         ┌─────▼───┐ ┌───▼───┐ ┌──▼────────┐    │
│         │  Cursor  │ │ Vim   │ │Ghost Hints│    │
│         │          │ │ Mode  │ │           │    │
│         └──────────┘ └───────┘ └───────────┘    │
│                                                   │
│  ┌────────────────┐  ┌──────────────────────┐   │
│  │ConfirmDialog   │  │ ToolUseDisplay       │   │
│  │(destructive ops)│  │(progress, result)    │   │
│  └────────────────┘  └──────────────────────┘   │
│                                                   │
│  ┌────────────────┐  ┌──────────────────────┐   │
│  │PermissionPrompt│  │    Setup Wizard      │   │
│  │(tool access)   │  │  (first-run flow)    │   │
│  └────────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────┘
```

---

## Componentes

### 1. App.tsx 🟢

**Responsabilidade:** Root component que orquestra estado visual.

**Estado gerenciado:**
- `messages: Message[]` — histórico visível
- `isProcessing: boolean` — agente está pensando
- `currentTool: ToolStatus | null` — tool em execução
- `confirmPending: ConfirmRequest | null` — dialog de confirmação
- `permissionPending: PermissionRequest | null` — prompt de permissão
- `interactionMode: "plan" | "build" | "auto"` — modo atual

**Event handlers:**
- `onSubmit(text)` — processa input (command ou mensagem)
- `onModeSwitch()` — Shift+Tab → cicla modo
- `onConfirmResponse(bool)` — resposta ao confirm dialog
- `onPermissionResponse(bool)` — resposta ao permission prompt

### 2. InputBox (`input/InputBox.tsx`) 🟢

**Responsabilidade:** Editor multiline com cursor management.

**Features:**
- Cursor position tracking (line, col)
- Selection range
- Kill ring (clipboard circular, Ctrl+K/Y)
- Paste detection (burst > 3 chars in < 50ms → paste mode)
- History navigation (seta up/down)
- Auto-indent
- Multi-line via Shift+Enter

**Props:**
```
onSubmit: (text: string) => void
placeholder?: string
vimMode?: boolean
disabled?: boolean
```

### 3. Cursor (`input/Cursor.ts`) 🟢

**Responsabilidade:** Estado de posição e seleção.

**Estado:**
- `line: number`, `col: number`
- `selectionStart: Position | null`
- `selectionEnd: Position | null`
- `killRing: string[]` (circular, max entries)

### 4. Vim Mode (`input/vim/`) 🟢

**Responsabilidade:** Implementação de vim keybindings.

**Modos:**
- Normal: motions (h,j,k,l,w,b,e,0,$,gg,G), operators (d,c,y,p), commands (:w, :q)
- Insert: i,a,o,O — input normal
- Visual: v,V — seleção por char ou linha

**Implementação:** State machine que intercepta keypress e traduz para operações no buffer.

### 5. Ghost Hints (`input/GhostHints.tsx`) 🟢

**Responsabilidade:** Sugestões visuais inline.

**Tipos:**
- Command autocomplete: `/mo` → ghost `del` (completa `/model`)
- History ghost: input vazio → última mensagem como ghost
- Argument hints: `/model ` → ghost com modelos disponíveis

### 6. MessageList (`messages/MessageList.tsx`) 🟢

**Responsabilidade:** Renderiza histórico de mensagens.

**Renderização por tipo:**
| Role | Formatação |
|------|------------|
| user | Prefixo colorido, texto plain |
| assistant | Markdown rendered (syntax highlight, bold, lists) |
| tool | Nome da tool + resultado (diff ou texto) |
| system | Oculto (ou exibido com /system) |
| thinking | Colapsável, cor diferenciada |

### 7. StatusBar (`StatusBar.tsx`) 🟢

**Responsabilidade:** Barra de informações inferior.

**Layout:** `[Model] | [Mode] | [Tokens in/out] | [$Cost] | [Vim?]`

### 8. ConfirmDialog 🟢

**Responsabilidade:** Prompt Y/N para operações destrutivas.

**Trigger:** Shell destrutivo em Build mode, config writes.
**UI:** Mensagem + `[Y/n]` com highlight no default.

### 9. ToolUseDisplay 🟢

**Responsabilidade:** Mostra progresso de tools em execução.

**Estados:** pending → running (spinner) → done (result preview)
**Info:** tool name, args resumidos, duração

### 10. PermissionPrompt 🟢

**Responsabilidade:** Solicita permissão para tool não coberta por rules.

**UI:** Tool name + args + `[Allow / Deny / Always Allow]`

### 11. Setup Wizard (`setup/`) 🟢

**Responsabilidade:** Fluxo de primeira execução.

**Steps:**
1. Selecionar provider (DeepSeek / Bedrock / Vertex / Local)
2. Inserir credenciais (API key, região, etc.)
3. Testar conexão
4. Salvar em settings

---

## Interaction Mode State Machine

```
        Shift+Tab         Shift+Tab         Shift+Tab
  Plan ──────────► Build ──────────► Auto ──────────► Plan
   │                 │                 │
   │ Tools:          │ Tools:          │ Tools:
   │ read-only       │ all (confirm    │ all (no
   │ only            │ destructive)    │ confirm)
   │                 │                 │
   │ Ativação:       │ Ativação:       │ Ativação:
   │ user ou model   │ default         │ SOMENTE user
```

---

## Decisões de Design

| Decisão | Rationale | Confiança |
|---------|-----------|-----------|
| React components (via Ink fork) | Reuso de paradigma familiar, state management declarativo | 🟢 |
| Vim mode como opt-in | Não penaliza users que não usam vim | 🟢 |
| Paste detection por timing | Alternativa mais confiável que bracketed paste em todos os terminais | 🟢 |
| Kill ring ao invés de clipboard | Terminal não tem acesso confiável ao system clipboard | 🟢 |
| Mode cycling via Shift+Tab | Não conflita com Tab (indent), fácil de lembrar | 🟢 |
| Confirm dialog blocking | Garante que user responde antes de prosseguir | 🟢 |
