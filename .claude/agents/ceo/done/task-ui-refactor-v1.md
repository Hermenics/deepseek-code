# TASK: Refatoração Visual da TUI — DeepSeek Code
**Status:** concluído ✅  
**Criado:** 2026-04-19  
**Responsável:** CEO → Designer + Coder

---

## Objetivo
Elevar a qualidade visual da TUI do DeepSeek Code ao nível de Claude Code, Codex CLI e Kiro CLI, mantendo a arquitetura Ink/React existente e sem quebrar nenhuma funcionalidade.

---

## Escopo das Mudanças

### Etapa 1 — Designer: Redesign Visual Completo
Arquivos: MessageList.tsx, InputBox.tsx, StatusBar.tsx, ToolUseDisplay.tsx, TodoPanel.tsx, WelcomeScreen.tsx, Mascot.tsx, App.tsx (ConfirmPrompt, ToolPermissionPrompt)

### Etapa 2 — Coder: Correções Lógicas + Integração
Arquivos: MessageList.tsx (fix streaming markdown), InputBox.tsx (mensagens PT-BR)

---

## Critérios de Aceitação
- [ ] Stream text renderiza markdown (não plain text)
- [ ] Mensagens de loading em Português do Brasil
- [ ] Header mais limpo e profissional
- [ ] InputBox com visual polido (separadores, prompt)
- [ ] StatusBar mais informativa e bem alinhada
- [ ] ToolUseDisplay com hierarquia visual clara
- [ ] TodoPanel com design refinado
- [ ] WelcomeScreen impressionante
- [ ] Nenhuma funcionalidade quebrada
- [ ] Build passa sem erros TypeScript
