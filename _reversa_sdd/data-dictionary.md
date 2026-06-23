# Dicionário de Dados — deepseek-code

> Gerado pelo Arqueólogo (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Entidades / Interfaces Principais

### ProviderConfig

🟢 CONFIRMADO — `src/types/provider.ts`

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| provider | `'deepseek' \| 'bedrock' \| 'vertex' \| 'local'` | sim | Provider ativo |
| apiKey | string | não | API key (DeepSeek) |
| baseURL | string | não | URL base custom |
| awsRegion | string | não | Região AWS (default: us-east-1) |
| awsProfile | string | não | Profile AWS (default: default) |
| gcpProject | string | não | Projeto GCP |
| gcpLocation | string | não | Location GCP (default: us-central1) |
| gcpCredentials | string | não | Caminho para service account JSON |
| localBaseUrl | string | não | URL do LLM local (default: http://localhost:11434/v1) |
| localModel | string | não | Modelo local |
| proxyApiKey | string | não | API key para o proxy server |

---

### AgentConfig

🟢 CONFIRMADO — `src/agent/config.ts`

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| name | string | sim | Nome do agente |
| model | Model | não | Override de modelo |
| systemPrompt | string | sim | System prompt do agente |
| files | string[] | não | Arquivos a injetar no contexto |
| allowedTools | `string[] \| '*'` | não | Whitelist de tools ou '*' para pedir confirmação em todas |

---

### SessionData

🟢 CONFIRMADO — `src/agent/session.ts`

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| id | string | sim | Hex aleatório (12 chars) |
| createdAt | string (ISO 8601) | sim | Timestamp de criação |
| updatedAt | string (ISO 8601) | sim | Timestamp de última atualização |
| cwd | string | sim | Working directory da sessão |
| model | string | sim | Modelo ativo |
| provider | string | sim | Provider ativo |
| language | string \| null | sim | Idioma preferido |
| activeAgent | string \| null | sim | Nome do agente custom ativo |
| agentMessages | MessageOrBoundary[] | sim | Histórico completo (inclui boundaries) |
| uiMessages | Message[] | sim | Mensagens renderizadas na UI |
| filesModified | string[] | sim | Arquivos modificados na sessão |

---

### Checkpoint

🟢 CONFIRMADO — `src/agent/checkpoint.ts`

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| id | string | sim | `{timestamp}-{randomHex}` |
| timestamp | string (ISO 8601) | sim | Quando foi salvo |
| label | string | sim | Rótulo (default: data/hora local) |
| messages | MessageOrBoundary[] | sim | Snapshot das mensagens |
| filesModified | string[] | sim | Arquivos rastreados |

---

### AppState

🟢 CONFIRMADO — `src/state/store.ts`

| Campo | Tipo | Obrigatório | Default | Descrição |
|-------|------|-------------|---------|-----------|
| sessionId | string | sim | '' | ID da sessão ativa |
| provider | string | sim | 'deepseek' | Provider ativo |
| model | string | sim | 'deepseek-chat' | Modelo ativo |
| tokenCount | number | sim | 0 | Total de tokens consumidos |
| contextUsage | number | sim | 0 | Tokens de prompt da última request |
| contextLimit | number | sim | 128,000 | Limite de contexto do modelo |
| activeAgent | string \| null | sim | null | Agente custom ativo |
| isProcessing | boolean | sim | false | Se está processando request |

---

### TokenUsage

🟢 CONFIRMADO — `src/agent/cost.ts`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| promptTokens | number | Total de tokens de prompt |
| completionTokens | number | Total de tokens de completion |
| cachedTokens | number | Tokens de prompt com cache hit |

---

### DeepSeekSettings

🟢 CONFIRMADO — `src/settings/types.ts`

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| permissions | PermissionsConfig | não | Regras allow/deny |
| hooks | HooksConfig | não | Configuração de hooks |
| model | string | não | Override de modelo |
| theme | string | não | Tema visual |
| language | string | não | Idioma preferido |
| autoCompact | boolean | não | Ativar auto-compact (default: true) |
| autoCompactThreshold | number | não | Threshold 0.0-1.0 (default: 0.85) |

---

### PermissionsConfig

🟢 CONFIRMADO — `src/settings/types.ts`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| allow | string[] | Ex: `["Shell(git *)", "ReadFile"]` |
| deny | string[] | Ex: `["WriteFile(*.env)", "Shell(rm *)"]` |

---

### HooksConfig

🟢 CONFIRMADO — `src/hooks/types.ts`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| PreToolUse | HookMatcher[] | Hooks antes de tool use |
| PostToolUse | HookMatcher[] | Hooks após tool use |
| SessionStart | HookCommand[] | Hooks ao iniciar sessão |

---

### HookMatcher

🟢 CONFIRMADO — `src/hooks/types.ts`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| matcher | string | Pattern: `"*"`, `"Shell"`, `"Shell\|WriteFile"` |
| hooks | HookCommand[] | Lista de hooks a executar |

---

### HookCommand

🟢 CONFIRMADO — `src/hooks/types.ts`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| type | 'command' | Tipo fixo |
| command | string | Shell command a executar |
| timeout | number | Timeout em segundos (default: 30) |

---

### HookInput

🟢 CONFIRMADO — `src/hooks/types.ts`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| event | HookEvent | 'PreToolUse' \| 'PostToolUse' \| 'SessionStart' |
| session_id | string | UUID da sessão |
| tool_name | string | Nome da tool (Pre/PostToolUse) |
| tool_input | Record<string, unknown> | Args da tool |
| tool_result | string | Resultado (PostToolUse only) |

---

### Tool

🟢 CONFIRMADO — `src/tools/types.ts`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| name | string | Identificador único |
| description | string | Descrição para o LLM |
| parameters | object | JSON Schema dos parâmetros |
| execute | `(args) => Promise<string>` | Função de execução |

---

### TodoItem

🟢 CONFIRMADO — `src/agent/todoStore.ts`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | string | Hex aleatório (8 chars) |
| title | string | Título da tarefa |
| status | `'pending' \| 'in_progress' \| 'done'` | Estado |

---

### Message (UI)

🟢 CONFIRMADO — `src/ui/App.tsx`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| role | `'user' \| 'assistant' \| 'tool' \| 'terminal' \| 'thinking'` | Tipo da mensagem |
| content | string | Conteúdo textual |

---

### AuditEvent

🟢 CONFIRMADO — `src/agent/auditLog.ts`

| Tipo | Campos Extras |
|------|---------------|
| session_start | model, provider, cwd |
| tool_call | tool, args |
| tool_result | tool, result, durationMs |
| compact | reason |
| compact_error | reason |
| checkpoint | id, label? |
| session_end | totalTokens |
| mcp_server_load | serverName, transport |

---

### InteractionMode

🟢 CONFIRMADO — `src/ui/interactionMode.ts`

| Valor | Tools permitidas | Ativação |
|-------|------------------|----------|
| `'plan'` | Read-only (read_file, glob, grep, git, web_fetch, introspect, todo, subagent) | LLM ou usuário |
| `'build'` | Todas + confirmação para destructive/config | LLM ou usuário |
| `'auto'` | Todas sem restrição | Somente usuário (Shift+Tab) |

---

### AutoCompactConfig

🟢 CONFIRMADO — `src/services/compact/autoCompact.ts`

| Campo | Tipo | Default | Descrição |
|-------|------|---------|-----------|
| enabled | boolean | true | Se auto-compact está ativo |
| threshold | number | 0.85 | Ratio context/limit para trigger |
| bufferTokens | number | 13,000 | Buffer reservado |
| maxConsecutiveFailures | number | 3 | Circuit breaker |

---

### ProxyConfig (inferido)

🟡 INFERIDO — `src/agent/providers/proxy/config.ts`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| host | string | Hostname do server |
| port | number | Porta HTTP |
| poolSize | number | Tamanho do pool de páginas Playwright |
| proxyApiKey | string | API key para autenticação |
| corsOrigins | string | Origens CORS permitidas |
| rateLimit | object | Configuração de rate limiting |
| logLevel | string | Nível de log |
