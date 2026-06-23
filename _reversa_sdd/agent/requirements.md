# Requirements — Módulo Agent

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Visão Geral

O módulo **Agent** é o core do sistema — gerencia o loop de conversação LLM, execução de tools, context management, providers, sessões, checkpoints e auditoria.

**Caminho:** `src/agent/`

---

## Requisitos Funcionais

### RF-01: Loop de Conversação 🟢

**Prioridade:** Must
**Descrição:** O agente deve manter um loop de conversação onde cada iteração envia o contexto ao LLM, recebe resposta (texto ou tool_calls) e executa tools até não haver mais chamadas pendentes.

**Critérios de Aceitação:**
- Dado que o usuário envia uma mensagem, quando o agente processa, então ele injeta a mensagem no histórico e chama o LLM
- Dado que o LLM retorna tool_calls, quando o agente recebe a resposta, então ele executa cada tool e adiciona os resultados ao histórico
- Dado que o LLM retorna texto final sem tool_calls, quando o agente recebe, então o loop encerra e a resposta é exibida

### RF-02: Streaming 🟢

**Prioridade:** Must
**Descrição:** O agente deve suportar streaming de respostas via SSE chunks (texto e reasoning_content) quando o provider suporta.

**Critérios de Aceitação:**
- Dado que streaming está habilitado e o provider suporta, quando o LLM responde, então chunks são exibidos incrementalmente ao usuário
- Dado que streaming está desabilitado (Vertex, Bedrock R1), quando o LLM responde, então a resposta completa é retornada de uma vez

### RF-03: Tool Execution 🟢

**Prioridade:** Must
**Descrição:** O agente deve executar tools retornadas pelo LLM, respeitando permissões do interaction mode, regras allow/deny e hooks.

**Critérios de Aceitação:**
- Dado que o mode é Plan, quando o LLM retorna uma tool de escrita, então a execução é bloqueada
- Dado que o mode é Build e a tool é destrutiva, quando o agente processa, então uma confirmação é solicitada ao usuário
- Dado que o mode é Auto, quando o LLM retorna qualquer tool, então ela é executada sem confirmação
- Dado que tools são parallel-safe (grep, glob, read_file, etc.), quando múltiplas são retornadas, então executam concorrentemente

### RF-04: Provider Factory 🟢

**Prioridade:** Must
**Descrição:** O agente deve criar clientes LLM para qualquer provider configurado (DeepSeek, Bedrock, Vertex, Local, Proxy).

**Critérios de Aceitação:**
- Dado que o provider é "deepseek", quando o client é criado, então usa OpenAI SDK apontando para `api.deepseek.com`
- Dado que o provider é "bedrock", quando o client é criado, então usa SigV4 signing com endpoint AWS
- Dado que o provider é "vertex", quando o client é criado, então usa OAuth2 com endpoint GCP
- Dado que o provider é "local", quando o client é criado, então usa OpenAI SDK apontando para localhost
- Dado que o provider é "proxy", quando o client é criado, então usa o servidor Hono local

### RF-05: Auto-Compact 🟢

**Prioridade:** Must
**Descrição:** O agente deve compactar automaticamente o contexto quando o uso atinge 85% do limite.

**Critérios de Aceitação:**
- Dado que `contextUsage/contextLimit > 0.85`, quando o loop inicia nova iteração, então auto-compact é acionado
- Dado que auto-compact falhou 3 vezes consecutivas, quando o threshold é atingido novamente, então o compact é desativado (circuit breaker)

### RF-06: MicroCompact 🟢

**Prioridade:** Must
**Descrição:** O agente deve truncar tool results antigos, preservando apenas os 5 mais recentes.

**Critérios de Aceitação:**
- Dado que existem mais de 5 tool results no histórico, quando MicroCompact executa, então os anteriores aos últimos 5 são truncados
- Dado que existem 5 ou menos tool results, quando MicroCompact executa, então nenhum é removido

### RF-07: Retry com Backoff 🟢

**Prioridade:** Must
**Descrição:** O agente deve retentar chamadas LLM que falham com HTTP 429 ou 503, com backoff exponencial.

**Critérios de Aceitação:**
- Dado que a API retorna 429 ou 503, quando o agente processa o erro, então retenta após 1s, 2s, 4s
- Dado que o request foi abortado (signal), quando o erro é processado, então NÃO retenta

### RF-08: Sessões 🟢

**Prioridade:** Must
**Descrição:** O agente deve persistir sessões em JSON para permitir continuação posterior.

**Critérios de Aceitação:**
- Dado que a sessão está ativa, quando há mudança de estado, então a sessão é salva em `~/.deepseek/sessions/{id}.json`
- Dado que existem mais de 50 sessões, quando uma nova é salva, então a mais antiga é removida (prune)

### RF-09: Checkpoints 🟢

**Prioridade:** Must
**Descrição:** O agente deve permitir salvar e restaurar snapshots do estado de conversação.

**Critérios de Aceitação:**
- Dado que o usuário solicita checkpoint (via /checkpoint), quando o comando executa, então o estado é salvo com ID `timestamp-randomHex`
- Dado que existem mais de 20 checkpoints, quando um novo é salvo, então o mais antigo é removido

### RF-10: Undo Stack 🟢

**Prioridade:** Should
**Descrição:** O agente deve manter um stack de escritas em arquivo para desfazer (máximo 10 entries FIFO).

**Critérios de Aceitação:**
- Dado que o agente escreve um arquivo, quando write_file ou patch_file executa, então o conteúdo anterior é armazenado no undo stack
- Dado que o stack tem 10 entries, quando uma nova escrita ocorre, então a entry mais antiga é descartada
- Dado que o usuário executa /undo, quando o comando processa, então o último arquivo escrito é restaurado

### RF-11: Hooks 🟢

**Prioridade:** Should
**Descrição:** O agente deve executar hooks configurados (PreToolUse, PostToolUse, SessionStart).

**Critérios de Aceitação:**
- Dado que um hook PreToolUse está configurado, quando uma tool é executada, então o hook roda antes e pode bloquear
- Dado que um hook PostToolUse está configurado, quando uma tool termina, então o hook roda fire-and-forget
- Dado que hooks de project-level existem, quando settings são carregados, então esses hooks são stripados

### RF-12: Steering 🟢

**Prioridade:** Should
**Descrição:** O agente deve carregar arquivos de steering custom e injetá-los no system prompt.

**Critérios de Aceitação:**
- Dado que existem arquivos em `.deepseek/steering/*.md`, quando o agente inicializa, então o conteúdo é concatenado ao system prompt
- Dado que existe `DEEPSEEK.md` na raiz, quando o agente inicializa, então o conteúdo é injetado no prompt

### RF-13: Custom Agents 🟢

**Prioridade:** Could
**Descrição:** O agente deve suportar configurações custom via JSON que alteram modelo, prompt e tools disponíveis.

**Critérios de Aceitação:**
- Dado que um agent JSON existe em `.deepseek/agents/`, quando /agent é executado, então o agent custom é carregado
- Dado que o agent define `allowedTools`, quando uma tool não está na lista, então ela é bloqueada

### RF-14: Audit Log 🟢

**Prioridade:** Should
**Descrição:** O agente deve registrar eventos em log JSONL append-only.

**Critérios de Aceitação:**
- Dado que qualquer evento significativo ocorre (tool_call, compact, checkpoint), quando é processado, então um registro é adicionado ao JSONL
- Dado que uma nova sessão inicia, quando o log é criado, então o arquivo é `~/.deepseek/logs/session-{id}.jsonl`

### RF-15: MCP Integration 🟢

**Prioridade:** Should
**Descrição:** O agente deve carregar tools de servidores MCP externos (stdio ou HTTP).

**Critérios de Aceitação:**
- Dado que MCP servers estão configurados em settings, quando o agente inicializa, então as tools MCP são carregadas
- Dado que um MCP server usa env vars críticos, quando o env é montado, então PATH/LD_PRELOAD/etc. são bloqueados

### RF-16: Cost Estimation 🟢

**Prioridade:** Could
**Descrição:** O agente deve estimar custo monetário baseado em tokens consumidos.

**Critérios de Aceitação:**
- Dado que o modelo é deepseek-chat, quando tokens são contabilizados, então o custo é calculado com pricing table atual
- Dado que o usuário executa /cost, quando o comando roda, então input/output/cached tokens e custo total são exibidos

---

## Requisitos Não Funcionais

| # | Categoria | Requisito | Confiança |
|---|-----------|-----------|-----------|
| RNF-01 | Performance | Retry com backoff exponencial (1s, 2s, 4s) para rate limiting | 🟢 |
| RNF-02 | Performance | Parallel execution para tools read-only | 🟢 |
| RNF-03 | Segurança | Permissions validadas antes de cada tool execution | 🟢 |
| RNF-04 | Segurança | Hooks de project-level stripados (previne repos maliciosos) | 🟢 |
| RNF-05 | Segurança | MCP env vars críticos nunca sobrescritos | 🟢 |
| RNF-06 | Disponibilidade | Circuit breaker em auto-compact (3 falhas = desativa) | 🟢 |
| RNF-07 | Persistência | Max 50 sessões, 20 checkpoints, 500 msgs history | 🟢 |
| RNF-08 | Observabilidade | Audit log JSONL com todos os eventos | 🟢 |

---

## MoSCoW Summary

| Prioridade | Requisitos |
|------------|------------|
| **Must** | RF-01 a RF-09 (loop, streaming, tools, providers, compact, micro-compact, retry, sessões, checkpoints) |
| **Should** | RF-10 a RF-12, RF-14, RF-15 (undo, hooks, steering, audit, MCP) |
| **Could** | RF-13, RF-16 (custom agents, cost estimation) |
| **Won't** | N/A |

---

## Dependências

| Depende de | Motivo |
|------------|--------|
| `tools` | Execução de ferramentas |
| `permissions` | Validação de acesso |
| `hooks` | Interceptação de tool use |
| `settings` | Configurações (model, provider, threshold) |
| `state` | Estado global (tokenCount, isProcessing) |
| `services/compact` | Auto-compact service |
| `constants` | Limites e defaults |
