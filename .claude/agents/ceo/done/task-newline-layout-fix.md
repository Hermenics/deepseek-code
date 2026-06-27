# Task: fix-newline-layout

## Contexto
No Ink (React para terminal), passar strings com `\n` diretamente para `<Text>` dentro de um `<Box>` causa linhas vazias fora do componente pai. O bug afeta:
- Mensagens do usuário com múltiplas linhas
- Stream do assistente com `\n`
- Mensagens de terminal com `\n`

## Arquivos Afetados
- `src/ui/messages/MessageList.tsx`

## Escopo
Corrigir a renderização de strings com `\n` nos seguintes pontos de `MessageList.tsx`:
1. `MessageItem` role `user` — `<Text>{m.content}</Text>`
2. `MessageItem` role `terminal` — `<Text wrap="wrap">{m.content}</Text>`
3. Stream assistente — `<Text wrap="wrap">{streamText}</Text>`
4. Stream terminal — `<Text wrap="wrap">{streamText}</Text>`

## Critérios de Aceitação
- [ ] Mensagem do usuário com `\n` renderiza cada linha sem criar linhas vazias fora do Box
- [ ] Mensagem terminal com `\n` renderiza corretamente
- [ ] Stream do assistente com `\n` renderiza sem linhas vazias
- [ ] Stream terminal com `\n` renderiza sem linhas vazias
- [ ] Mensagens sem `\n` continuam funcionando normalmente
- [ ] Mensagens vazias (`""`) não quebram

## Critérios de Teste
- [ ] Snapshot/render de mensagem user com `"linha1\nlinha2"` → 2 Text nodes, sem Box vazio
- [ ] Snapshot/render de mensagem user com `"texto simples"` → 1 Text node
- [ ] Snapshot/render de stream com `"a\nb\nc"` → 3 Text nodes
- [ ] Snapshot/render de mensagem terminal com `\n` → sem linhas extras
- [ ] Edge case: string só com `\n` → não quebra
- [ ] Edge case: string com `\n` no início/fim → não cria linhas vazias extras

## Solução Esperada
Criar helper `renderLines(text: string)` que divide por `\n` e retorna `<Box flexDirection="column">` com um `<Text>` por linha. Substituir os 4 pontos afetados.

## Referências
- Task file: `.claude/agents/ceo/task-newline-layout-fix.md`
- Arquivo principal: `src/ui/messages/MessageList.tsx`
- Testes existentes: `tests/` (verificar padrão)
