# Design — Módulo Commands

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Arquitetura Interna

```
┌────────────────────────────────────────────┐
│           Command Dispatcher               │
│  input.startsWith("/") → lookup → parse    │
├────────────────────────────────────────────┤
│                                            │
│  src/commands/{name}/index.ts              │
│  Cada um exporta: { name, aliases, parse } │
│                                            │
│  ┌────────┐ ┌────────┐ ┌────────────────┐ │
│  │ /model │ │ /clear │ │ /compact       │ │
│  ├────────┤ ├────────┤ ├────────────────┤ │
│  │ /plan  │ │/review │ │ /agent         │ │
│  ├────────┤ ├────────┤ ├────────────────┤ │
│  │ /vim   │ │ /quit  │ │ /checkpoint    │ │
│  ├────────┤ ├────────┤ ├────────────────┤ │
│  │/sessions││ /undo  │ │ /cost          │ │
│  ├────────┤ ├────────┤ ├────────────────┤ │
│  │/perms  │ │ /help  │ │ /theme /lang   │ │
│  ├────────┤ ├────────┤ ├────────────────┤ │
│  │ /retry │ │ /files │ │ /tools /system │ │
│  ├────────┤ ├────────┤ ├────────────────┤ │
│  │ /msg   │ │ /stats │ │ /models/agents │ │
│  └────────┘ └────────┘ └────────────────┘ │
└────────────────────────────────────────────┘
```

---

## Interface Command 🟢

```ts
interface Command {
  name: string
  aliases: string[]
  parse(args: string[]): CommandResult
}

type CommandResult =
  | { type: "message"; content: string }
  | { type: "action"; action: string; payload?: any }
  | { type: "error"; message: string }
```

---

## Dispatcher 🟢

**Localização:** `src/ui/App.tsx` (processamento de input)

**Fluxo:**
1. Input começa com `/` → extrai nome e args
2. Lookup em command registry por name ou alias
3. Se encontrado → `command.parse(args)`
4. Se não encontrado → mensagem de erro "unknown command"
5. Resultado processado pela UI (exibe message, executa action, mostra error)

---

## Catálogo Detalhado

| Command | Aliases | Tipo de resultado | Side-effects |
|---------|---------|-------------------|--------------|
| /help | — | message (lista formatada) | Nenhum |
| /model | /m | action (setState model) | Muda modelo ativo |
| /models | — | message (lista) | Nenhum |
| /clear | /c | action (resetMessages) | Limpa histórico |
| /compact | — | action (agent.compact()) | Compacta contexto |
| /plan | /p | action (setMode Plan) | Muda interaction mode |
| /review | /r | action (review mode) | Inicia review |
| /theme | /t | action (setTheme) | Muda tema visual |
| /agent | /a | action (loadAgent) | Carrega/descarrega agent |
| /agents | — | message (lista agents) | Nenhum |
| /vim | — | action (toggleVim) | Alterna vim mode |
| /quit | /q, /exit | action (exit) | Encerra processo |
| /checkpoint | /cp | action (save/list/restore) | Persiste/restaura state |
| /sessions | — | message (lista) | Nenhum |
| /language | /lang | action (setLanguage) | Muda idioma |
| /undo | /u | action (agent.undo()) | Restaura arquivo |
| /retry | — | action (resend last) | Re-envia ao LLM |
| /cost | — | message (breakdown) | Nenhum |
| /files | — | message (lista modified) | Nenhum |
| /tools | — | message (lista tools) | Nenhum |
| /system | — | message (system prompt) | Nenhum |
| /permissions | /perms | message (rules) | Nenhum |
| /msg | — | action (addNote) | Injeta nota no contexto |
| /stats | — | message (stats sessão) | Nenhum |

---

## Decisões de Design

| Decisão | Rationale | Confiança |
|---------|-----------|-----------|
| Um módulo por command | Isolamento, facilidade de adicionar novos | 🟢 |
| Aliases como array | Suporte a shortcuts curtos (/m, /c, /q) | 🟢 |
| parse() retorna tipado | UI processa resultado de forma uniforme | 🟢 |
| Commands não acessam agent diretamente | Retornam actions que a UI executa | 🟡 |
