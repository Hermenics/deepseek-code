# Design — Módulo Agent

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Arquitetura Interna

```
┌──────────────────────────────────────────────────┐
│                   Agent Class                      │
│                                                    │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ initialize│  │  runLoop │  │checkAndExecute│  │
│  │           │  │          │  │    Tool       │  │
│  └─────┬────┘  └────┬─────┘  └───────┬───────┘  │
│        │             │                │           │
│  ┌─────▼────┐  ┌────▼─────┐  ┌───────▼───────┐  │
│  │ Steering │  │LLM Client│  │  Permission   │  │
│  │ Loader   │  │ Factory  │  │  Resolver     │  │
│  └──────────┘  └──────────┘  └───────────────┘  │
│                                                    │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Compact  │  │ Session  │  │  Checkpoint   │  │
│  │ Service  │  │ Manager  │  │  Manager      │  │
│  └──────────┘  └──────────┘  └───────────────┘  │
│                                                    │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  Audit   │  │   Cost   │  │    MCP        │  │
│  │  Logger  │  │Estimator │  │ Integration   │  │
│  └──────────┘  └──────────┘  └───────────────┘  │
└──────────────────────────────────────────────────┘
```

---

## Componentes

### 1. Agent Class (`agent.ts`) 🟢

**Responsabilidade:** Orquestra todo o ciclo de vida de uma conversa.

**Estado interno:**
- `messages: Message[]` — histórico completo
- `undoStack: UndoEntry[]` — max 10
- `abortController: AbortController` — para cancelar requests
- `compactFailCount: number` — circuit breaker
- `readyPromise: Promise<void>` — inicialização assíncrona

**Métodos principais:**
| Método | Função |
|--------|--------|
| `initialize()` | Carrega steering, settings, MCP tools, executa SessionStart hooks |
| `run(userMessage)` | Entry point — injeta mensagem, chama `runLoop()` |
| `runLoop()` | Loop principal: microCompact → autoCompact → LLM call → tool exec |
| `checkAndExecuteTool(call)` | Valida permissões, executa hook pre, roda tool, hook post |
| `undo()` | Restaura último arquivo do undoStack |
| `compact()` | Compactação manual (via /compact) |
| `saveSession()` | Persiste estado em JSON |
| `saveCheckpoint(label)` | Snapshot pontual |

### 2. LLM Client Factory (`llmClient.ts`) 🟢

**Responsabilidade:** Cria instância OpenAI SDK configurada para o provider ativo.

**Lógica de criação:**
```
provider → switch:
  "deepseek" → OpenAI({ baseURL: "https://api.deepseek.com/v1", apiKey })
  "bedrock"  → BedrockClient({ region, model }) via import dinâmico
  "vertex"   → VertexClient({ project, location }) via import dinâmico
  "local"    → OpenAI({ baseURL: "http://localhost:11434/v1" })
  "proxy"    → OpenAI({ baseURL: "http://localhost:{port}/v1" })
```

### 3. Steering Loader (`steering.ts`) 🟢

**Responsabilidade:** Carrega e concatena arquivos de contexto custom.

**Fontes (ordem de carregamento):**
1. `.deepseek/steering/*.md` (project-level)
2. `DEEPSEEK.md` (raiz do projeto)
3. `.deepseek/DEEPSEEK.md` (alternativo)

**Output:** String concatenada injetada após o system prompt base.

### 4. Compact Service 🟢

**Responsabilidade:** Gerencia auto-compact e micro-compact.

**Auto-Compact:**
- Trigger: `contextUsage / contextLimit > threshold` (default 0.85)
- Ação: Envia histórico ao LLM com prompt de sumarização
- Resultado: Substitui histórico por boundary marker + summary
- Circuit breaker: 3 falhas → desativa

**MicroCompact:**
- Trigger: A cada iteração do loop (antes do auto-compact)
- Ação: Trunca `content` de tool_results com index < (total - 5)
- Resultado: Tool results antigos ficam com placeholder

### 5. Session Manager (`session.ts`) 🟢

**Responsabilidade:** Persistência e recuperação de sessões.

**Schema:**
```json
{
  "id": "hex12",
  "cwd": "/path/to/project",
  "model": "deepseek-chat",
  "provider": "deepseek",
  "messages": [...],
  "filesModified": ["file1.ts", ...],
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

**Prune:** Quando count > 50, remove mais antigas por `updatedAt`.

### 6. Checkpoint Manager (`checkpoint.ts`) 🟢

**Responsabilidade:** Snapshots pontuais para undo/restore de estado.

**ID format:** `{timestamp}-{randomHex4}`
**Prune:** Quando count > 20, remove mais antigos.
**Conteúdo:** messages + filesModified + model + provider.

### 7. Audit Logger (`auditLog.ts`) 🟢

**Responsabilidade:** Log append-only de eventos.

**Formato:** JSONL em `~/.deepseek/logs/session-{id}.jsonl`
**Eventos:** session_start, tool_call, tool_result, compact, checkpoint, session_end, mcp_server_load.

### 8. Cost Estimator (`cost.ts`) 🟢

**Responsabilidade:** Calcula custo monetário por token.

**Pricing table (Apr 2026):**
| Modelo | Input/1M | Cached/1M | Output/1M |
|--------|----------|-----------|-----------|
| deepseek-chat | $0.27 | $0.07 | $1.10 |
| deepseek-reasoner | $0.55 | $0.14 | $2.19 |

### 9. Compact Boundary (`compactBoundary.ts`) 🟢

**Responsabilidade:** Delimita contexto compactado vs. ativo.

**Mecanismo:**
- Insere mensagem com `role: "system"` e `content: "__compact_boundary__"`
- `getMessagesAfterBoundary()` retorna apenas mensagens após o último boundary + system prompt original

### 10. MCP Integration (`mcp.ts`) 🟢

**Responsabilidade:** Carrega tools de servidores MCP externos.

**Transports suportados:** stdio, HTTP Streamable
**Segurança:**
- Env vars bloqueados: PATH, LD_PRELOAD, HOME, NODE_OPTIONS, LD_LIBRARY_PATH
- Command injection patterns bloqueados: `;`, `&&`, `||`, `|`, `` ` ``, `$(`, `\n`
- Path traversal bloqueado: `..`

### 11. Custom Agent Config (`config.ts`) 🟢

**Responsabilidade:** Carrega e aplica configurações de agentes custom.

**Locais de busca:**
1. `.deepseek/agents/{name}.json` (project-local)
2. `~/.deepseek/agents/{name}.json` (global)

**Schema:**
```json
{
  "name": "my-agent",
  "model": "deepseek-reasoner",
  "systemPrompt": "You are...",
  "files": ["relevant-file.ts"],
  "allowedTools": ["read_file", "grep"]
}
```

---

## Fluxos Principais

### Fluxo 1: Loop Principal (runLoop)

```
1. MicroCompact (trunca tool results > 5)
2. Check auto-compact threshold
   2a. Se > 85% → compact → boundary marker
   2b. Se circuit breaker ativo → skip
3. Monta apiMessages (pós-boundary)
4. Chama LLM (streaming ou sync)
5. Processa resposta:
   5a. Se text only → return (loop end)
   5b. Se tool_calls → para cada call:
       - checkAndExecuteTool(call)
       - Adiciona result ao histórico
6. Volta para (1)
```

### Fluxo 2: checkAndExecuteTool

```
1. Resolve permissão (mode + rules + hooks)
2. Se denied → retorna mensagem de erro ao LLM
3. Se mode=Build e tool destrutiva → prompt confirm
   3a. User rejeita → retorna erro
4. Executa PreToolUse hooks
   4a. Se hook retorna block → retorna erro
5. Executa tool.execute(args)
6. Se tool é write/patch → push undoStack
7. Executa PostToolUse hooks (fire-and-forget)
8. Retorna resultado
```

### Fluxo 3: Inicialização

```
1. Em paralelo:
   - loadSteering() → concatena ao system prompt
   - loadDeepSeekMd() → concatena ao system prompt
   - loadMergedSettings() → aplica configs
   - loadMcpTools() → adiciona ao tool registry
2. Se Bedrock R1 → injeta tool definitions no prompt (XML format)
3. Executa SessionStart hooks
4. readyPromise resolve
```

---

## Decisões de Design

| Decisão | Rationale | Confiança |
|---------|-----------|-----------|
| Classe única Agent (~1093 linhas) | Centraliza orquestração, simplifica estado | 🟢 (DT6: candidata a decomposição) |
| OpenAI SDK como abstração universal | Todos providers expõem interface compatible | 🟢 |
| Circuit breaker no compact | Evita loop infinito se LLM não consegue sumarizar | 🟢 |
| Boundary markers no histórico | Permite manter system prompt original + contexto compactado sem perder referência | 🟢 |
| Tool results antigos truncados (micro) | Libera tokens sem perder contexto recente | 🟢 |
| reasoning_content preservado | Modelos DeepSeek exigem roundtrip do campo | 🟢 |

---

## Interfaces Externas

| Interface | Direção | Protocolo | Dados |
|-----------|---------|-----------|-------|
| DeepSeek API | Outbound | HTTPS (OpenAI compat) | Messages + tools |
| AWS Bedrock | Outbound | HTTPS (SigV4) | InvokeModel / ChatCompletions |
| Google Vertex | Outbound | HTTPS (OAuth2) | Predict |
| Local LLM | Outbound | HTTP (OpenAI compat) | Messages + tools |
| Proxy Server | Outbound | HTTP localhost | Messages (bridged) |
| MCP Servers | Outbound | stdio / HTTP | Tool definitions + calls |
| Filesystem | Bidirectional | Local FS | Sessions, checkpoints, logs, steering |
