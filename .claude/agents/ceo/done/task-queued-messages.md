# Task: Queued Messages + Input Desbloqueado

## Status: IN PROGRESS

## Contexto
Atualmente, quando o DeepSeek está trabalhando (`isLoading = true`), o `InputBox` é completamente substituído pelo `LoadingSpinner`. O usuário não pode digitar nada.

A feature adiciona:
1. Input sempre visível e digitável (mesmo durante loading)
2. Mensagens enfileiradas (queued) — Enter durante loading enfileira em vez de submeter
3. Lista de queued messages acima do input (estilo Claude Code)
4. Puns/trocadilhos acima do input (não mais substituindo-o)
5. Auto-envio da primeira mensagem da fila quando o agente termina (`onDone`)

## Arquivos Relevantes
- `src/ui/App.tsx` — estado principal (`isLoading`, `messages`), layout, callbacks `onDone`/`onToolResult`
- `src/ui/input/InputBox.tsx` — componente de input, `LoadingSpinner`, guard `if (s.isLoading) return`
- Novo: `src/ui/input/QueuedMessagesList.tsx` — lista de mensagens enfileiradas

## Escopo de Mudanças

### App.tsx
- Adicionar estado `queuedMessages: string[]`
- Adicionar handler `handleQueue(msg: string)` — push na fila
- Em `onDone`: se `queuedMessages.length > 0`, auto-submeter o primeiro e remover da fila
- Mover `<LoadingSpinner>` para fora do `InputBox`, renderizar acima do `<InputBox>` no layout
- Passar `onQueue` e `queuedMessages` como props para `InputBox`

### InputBox.tsx
- Remover o bloco condicional que substitui o input por `<LoadingSpinner>` quando `isLoading`
- Remover o guard `if (s.isLoading) return` no handler de teclado
- Quando Enter é pressionado e `isLoading === true`: chamar `onQueue(value)` e limpar o input
- Quando Enter é pressionado e `isLoading === false`: comportamento normal (submit)
- `LoadingSpinner` passa a ser renderizado em App.tsx

### QueuedMessagesList.tsx (novo)
- Renderiza a lista de mensagens enfileiradas
- Estilo similar ao Claude Code: cada item com ícone de "enfileirado" + texto truncado
- Posição: entre `LoadingSpinner` e `InputBox`

## Layout Final
```
[MessageList]
[ToolUseDisplay]     ← condicional, quando tool roda
[TodoPanel]
[LoadingSpinner]     ← condicional, quando isLoading (puns aqui)
[QueuedMessagesList] ← condicional, quando queue.length > 0
[InputBox]           ← SEMPRE visível
[StatusBar]
```

## Critérios de Aceitação
- [ ] Input sempre visível e digitável durante loading
- [ ] Enter durante loading enfileira a mensagem e limpa o input
- [ ] Lista de queued messages aparece acima do input quando há mensagens na fila
- [ ] Puns/trocadilhos aparecem acima do input (não substituem o input)
- [ ] Quando `onDone` é chamado, primeira mensagem da fila é auto-submetida
- [ ] Fila é FIFO — mensagens enviadas na ordem que foram enfileiradas
- [ ] Múltiplas mensagens podem ser enfileiradas
- [ ] Fila é limpa quando o agente termina e processa a primeira mensagem

## Critérios de Teste
- [ ] `handleQueue` adiciona mensagem ao array `queuedMessages`
- [ ] `onDone` com fila não-vazia: chama `handleSubmit` com `queuedMessages[0]` e remove da fila
- [ ] `onDone` com fila vazia: comportamento normal (sem submit)
- [ ] InputBox com `isLoading=true` + Enter: chama `onQueue`, não `onSubmit`
- [ ] InputBox com `isLoading=false` + Enter: chama `onSubmit`, não `onQueue`
- [ ] QueuedMessagesList renderiza N itens corretamente
- [ ] QueuedMessagesList não renderiza quando fila está vazia
