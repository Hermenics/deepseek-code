# Tasks — Módulo UI

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Tasks de Reimplementação

### T-UI-01: App Component (Root) 🟢

**Fonte:** `src/ui/App.tsx`
**Descrição:** Implementar componente raiz que orquestra mensagens, tool status, confirms, permissions e mode switching.

**Critério de pronto:**
- Renderiza MessageList + InputBox + StatusBar
- Processa input (detecta commands vs mensagens)
- Gerencia confirms e permission prompts
- Shift+Tab cicla interaction mode
- Auto-save de sessão em mudanças de estado

**Confiança:** 🟢

---

### T-UI-02: InputBox — Editor Multiline 🟢

**Fonte:** `src/ui/input/InputBox.tsx`
**Descrição:** Implementar editor de texto com cursor, seleção e paste detection.

**Critério de pronto:**
- Inserção/remoção de caracteres na posição do cursor
- Ctrl+A/E (início/fim), Ctrl+K (kill to end), Ctrl+Y (yank)
- Kill ring circular
- Paste detection (burst > 3 chars in < 50ms)
- Multi-line via Shift+Enter
- Submit via Enter
- History navigation via setas

**Confiança:** 🟢

---

### T-UI-03: Vim Mode 🟢

**Fonte:** `src/ui/input/vim/`
**Descrição:** Implementar vim keybindings com Normal/Insert/Visual.

**Critério de pronto:**
- Normal: h,j,k,l,w,b,e,0,$,gg,G (motions)
- Normal: d,c,y,p (operators + motion/text-object)
- Insert: i,a,o,O (enter), Esc (exit)
- Visual: v (char), V (line), operators sobre seleção
- State machine que intercepta keypress

**Confiança:** 🟢

---

### T-UI-04: Interaction Mode Manager 🟢

**Fonte:** `src/ui/interactionMode.ts`
**Descrição:** Implementar ciclo plan→build→auto com regras de ativação.

**Critério de pronto:**
- Shift+Tab avança no ciclo
- Plan: só tools read-only
- Build: todas, confirm para destrutivas
- Auto: tudo sem confirm, ativação SOMENTE pelo user
- Exporta `isToolAllowed(tool, mode)` para o agent

**Confiança:** 🟢

---

### T-UI-05: MessageList 🟢

**Fonte:** `src/ui/messages/MessageList.tsx`
**Descrição:** Implementar renderização de histórico por tipo.

**Critério de pronto:**
- User messages com prefixo colorido
- Assistant com markdown rendering (bold, code, lists)
- Tool results com diff formatting
- Thinking/reasoning colapsável
- Scroll automático para bottom

**Confiança:** 🟢

---

### T-UI-06: StatusBar 🟢

**Fonte:** `src/ui/StatusBar.tsx`
**Descrição:** Implementar barra de status inferior.

**Critério de pronto:**
- Mostra: model | mode | tokens (in/out) | cost | vim indicator
- Re-renderiza em mudanças de state
- Layout responsivo à largura do terminal

**Confiança:** 🟢

---

### T-UI-07: ConfirmDialog + PermissionPrompt 🟢

**Fonte:** `src/ui/App.tsx` (inline components)
**Descrição:** Implementar dialogs de confirmação e permissão.

**Critério de pronto:**
- ConfirmDialog: mensagem + [Y/n], blocking
- PermissionPrompt: tool + args + [Allow/Deny/Always]
- "Always" persiste como permission rule

**Confiança:** 🟢

---

### T-UI-08: Ghost Hints 🟢

**Fonte:** `src/ui/input/GhostHints.tsx`
**Descrição:** Implementar sugestões visuais inline.

**Critério de pronto:**
- Command autocomplete após `/`
- History ghost em input vazio
- Renderização em cor dim (não selecionável)
- Tab para aceitar hint

**Confiança:** 🟢

---

### T-UI-09: Setup Wizard 🟢

**Fonte:** `src/ui/setup/`
**Descrição:** Implementar fluxo de primeira execução.

**Critério de pronto:**
- Detecta ausência de config → exibe wizard
- Steps: provider → credentials → test → save
- Validação de API key com request de teste

**Confiança:** 🟢

---

### T-UI-10: ToolUseDisplay 🟢

**Fonte:** `src/ui/App.tsx` (componente de tool status)
**Descrição:** Implementar indicador de tool em execução.

**Critério de pronto:**
- Spinner durante execução
- Nome da tool + args resumidos
- Duração em tempo real
- Resultado preview ao completar

**Confiança:** 🟢

---

## Estimativa de Complexidade

| Task | Complexidade | LOC estimado |
|------|-------------|--------------|
| T-UI-01 | Alta | ~200 |
| T-UI-02 | Alta | ~180 |
| T-UI-03 | Alta | ~250 |
| T-UI-04 | Média | ~60 |
| T-UI-05 | Média | ~120 |
| T-UI-06 | Baixa | ~40 |
| T-UI-07 | Média | ~70 |
| T-UI-08 | Média | ~60 |
| T-UI-09 | Média | ~100 |
| T-UI-10 | Baixa | ~50 |
| **Total** | — | **~1130** |
