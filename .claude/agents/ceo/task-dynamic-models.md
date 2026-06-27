# Task: Modelos Dinamicos via API

## Status: EM ANDAMENTO
## Prioridade: Alta
## Branch: main (direto)

---

## Contexto
Substituir a lista hardcoded de modelos (deepseek-chat, deepseek-reasoner) por consulta dinamica via `client.models.list()`, exibindo todos os modelos que o servico configurado realmente disponibiliza.

## Escopo

### Arquivos a modificar:
1. `src/commands.ts` - `type Model` vira string, remover MODELS hardcoded, /model aceita qualquer string
2. `src/agent/agent.ts` - adicionar `getAvailableModels(): Promise<string[]>`
3. `src/ui/App.tsx` - buscar modelos antes de abrir seletor, passar como prop
4. `src/ui/setup/ModelSelector.tsx` - receber models como prop, loading state, sem hardcode

### Arquivos SEM mudanca:
- `src/agent/cost.ts` - ja usa fallback (linha 26)
- `src/agent/llmClient.ts` - sem mudanca necessaria

## Criterios de Aceitacao
- [ ] /models exibe modelos reais da API (ex: deepseek-v4-flash, deepseek-v4-pro)
- [ ] /model <qualquer-string> e aceito pelo parser
- [ ] ModelSelector nao tem nenhum model hardcoded
- [ ] type Model = string (sem quebrar outros usos)
- [ ] Fallback gracioso quando API nao suporta models.list()
- [ ] Loading state no ModelSelector enquanto busca

## Criterios de Teste
- [ ] parseCommand('/model deepseek-v4-flash') retorna { type: 'model', model: 'deepseek-v4-flash' }
- [ ] parseCommand('/model ') retorna unknown (string vazia)
- [ ] agent.getAvailableModels() retorna array de strings
- [ ] agent.getAvailableModels() retorna [] quando API falha
- [ ] ModelSelector renderiza lista vazia com mensagem adequada
- [ ] ModelSelector renderiza lista da API corretamente

## Riscos e Mitigacoes
- API nao suporta models.list() -> try/catch com fallback []
- Modelo atual nao esta na lista -> type Model = string resolve
- Latencia ao abrir seletor -> loading state no ModelSelector
