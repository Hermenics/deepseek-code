# Task: test-coverage-gaps

## Contexto
Auditoria de cobertura revelou 10 módulos sem nenhum teste. Esta task cobre todos os gaps identificados seguindo TDD (RED → GREEN).

## Módulos sem cobertura

### Grupo A — Agent (lógica de negócio)
| Arquivo | Exports principais | Criticidade |
|---|---|---|
| `src/agent/llmClient.ts` | `createLLMClient(cfg)`, `defaultModel(provider)` | 🔴 Alta |
| `src/agent/promptRefiner.ts` | `refinePrompt(client, model, msg)` | 🔴 Alta |
| `src/agent/auditLog.ts` | `auditLog(event)`, `getLogFile()` | 🟡 Média |
| `src/agent/inputHistory.ts` | `loadInputHistory()`, `appendInputHistory(entry)` | 🟡 Média |
| `src/agent/todoStore.ts` | `getTodos()`, `addTodo()`, `updateTodo()`, `clearTodos()`, `subscribe()` | 🟡 Média |
| `src/agent/steering.ts` | `loadSteering()` | 🟡 Média |

### Grupo B — Tools (ferramentas do agente)
| Arquivo | Comportamento crítico | Criticidade |
|---|---|---|
| `src/tools/WriteFile.ts` | `assertSafePath`, `computeDiff`, escrita, criação de dirs | 🔴 Alta |
| `src/tools/PatchFile.ts` | `assertSafePath`, match único, substituição exata | 🔴 Alta |
| `src/tools/UpdateKnowledge.ts` | criar/atualizar seção em DEEPSEEK.md, `escapeRegex` | 🟡 Média |
| `src/tools/WebFetch.ts` | fetch URL, strip HTML, truncar em 20k chars | 🟡 Média |

---

## Arquivos de teste a criar

| Arquivo de teste | Módulos cobertos |
|---|---|
| `tests/llmClient.test.ts` | `llmClient.ts` |
| `tests/promptRefiner.test.ts` | `promptRefiner.ts` |
| `tests/auditLog.test.ts` | `auditLog.ts` |
| `tests/inputHistory.test.ts` | `inputHistory.ts` |
| `tests/todoStore.test.ts` | `todoStore.ts` |
| `tests/steering.test.ts` | `steering.ts` |
| `tests/writeFile.test.ts` | `WriteFile.ts` |
| `tests/patchFile.test.ts` | `PatchFile.ts` |
| `tests/updateKnowledge.test.ts` | `UpdateKnowledge.ts` |
| `tests/webFetch.test.ts` | `WebFetch.ts` |

---

## Critérios de Aceitação por módulo

### llmClient.ts
- [ ] `createLLMClient` com provider `deepseek` retorna OpenAI com baseURL correta
- [ ] `createLLMClient` com provider `bedrock` usa região padrão `us-east-1`
- [ ] `createLLMClient` com provider `vertex` monta URL com project/location
- [ ] `createLLMClient` com provider `local` normaliza URL sem scheme (adiciona `http://`)
- [ ] `createLLMClient` com provider `local` preserva URL com scheme existente
- [ ] `defaultModel('deepseek')` retorna `'deepseek-chat'`
- [ ] `defaultModel('bedrock')` retorna modelo Claude correto
- [ ] `defaultModel('vertex')` retorna modelo Gemini correto
- [ ] `defaultModel('local')` retorna `'llama3'`

### promptRefiner.ts
- [ ] Mensagem com menos de 30 chars retorna original sem chamar API
- [ ] Mensagem começando com `/` retorna original sem chamar API
- [ ] API retornando `'SKIP'` retorna mensagem original
- [ ] API retornando prompt refinado retorna o refinado
- [ ] Erro na API retorna mensagem original (fallback silencioso)

### auditLog.ts
- [ ] `auditLog` escreve linha JSONL válida no arquivo de log
- [ ] `auditLog` cria diretório se não existir
- [ ] `auditLog` não lança exceção em caso de erro de I/O
- [ ] `getLogFile()` retorna path com `session-<timestamp>.jsonl`
- [ ] Múltiplas chamadas acumulam no mesmo arquivo

### inputHistory.ts
- [ ] `loadInputHistory` retorna `[]` se arquivo não existe
- [ ] `appendInputHistory` persiste entrada no arquivo
- [ ] `appendInputHistory` não duplica entrada consecutiva igual
- [ ] `appendInputHistory` respeita limite de 200 entradas (slice)
- [ ] `loadInputHistory` retorna entradas salvas corretamente

### todoStore.ts
- [ ] `getTodos()` retorna array vazio inicialmente
- [ ] `addTodo(title)` adiciona item com status `pending`
- [ ] `addTodo` retorna o item criado com `id` e `title`
- [ ] `updateTodo(id, status)` atualiza status e retorna `true`
- [ ] `updateTodo` com id inexistente retorna `false`
- [ ] `clearTodos()` esvazia a lista
- [ ] `subscribe` recebe notificação ao adicionar todo
- [ ] `subscribe` recebe notificação ao atualizar todo
- [ ] `subscribe` recebe notificação ao limpar todos
- [ ] Unsubscribe remove o listener

### steering.ts
- [ ] Retorna string vazia se diretório `.deepseek/steering` não existe
- [ ] Lê e concatena arquivos `.md` do diretório
- [ ] Ignora arquivos que não são `.md`
- [ ] Formata cada arquivo com `--- filename ---\ncontent`

### WriteFile.ts
- [ ] Escreve arquivo com conteúdo correto
- [ ] Cria diretórios pai se não existirem
- [ ] Retorna JSON com `__diff: true` e contagens de linhas
- [ ] `assertSafePath` lança erro para path fora do cwd
- [ ] `assertSafePath` aceita path dentro do cwd
- [ ] `computeDiff` detecta linhas adicionadas
- [ ] `computeDiff` detecta linhas removidas
- [ ] `computeDiff` detecta linhas de contexto
- [ ] Arquivo novo (sem conteúdo anterior) gera diff correto

### PatchFile.ts
- [ ] Substitui `old_content` por `new_content` corretamente
- [ ] Retorna erro se arquivo não existe
- [ ] Retorna erro se `old_content` não encontrado
- [ ] Retorna erro se `old_content` encontrado mais de uma vez
- [ ] `assertSafePath` lança erro para path fora do cwd
- [ ] Retorna string com contagem de linhas adicionadas/removidas

### UpdateKnowledge.ts
- [ ] Cria DEEPSEEK.md com cabeçalho se não existir
- [ ] Adiciona nova seção ao arquivo existente
- [ ] Atualiza seção existente sem duplicar
- [ ] `escapeRegex` escapa caracteres especiais de regex
- [ ] Retorna mensagem de confirmação com nome da seção

### WebFetch.ts
- [ ] Faz fetch da URL e retorna texto limpo
- [ ] Remove tags HTML do conteúdo
- [ ] Trunca conteúdo em 20.000 chars

---

## Critérios de Teste Gerais
- Usar `bun:test` (`describe`, `it`, `expect`, `mock`, `beforeEach`)
- Mockar I/O de filesystem onde necessário (evitar efeitos colaterais)
- Mockar chamadas de rede (fetch, OpenAI client)
- Cada arquivo de teste deve ser independente (sem estado compartilhado)
- Rodar `bun test` completo ao final — 0 falhas

## Referências
- Task file: `.claude/agents/ceo/task-test-coverage-gaps.md`
- Padrão de testes: `tests/tools.test.ts`, `tests/agent.test.ts`, `tests/fs.test.ts`
- Módulos fonte: `src/agent/`, `src/tools/`
