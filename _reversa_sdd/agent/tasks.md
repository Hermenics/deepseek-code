# Tasks — Módulo Agent

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Tasks de Reimplementação

### T-AG-01: Classe Agent — Loop Principal 🟢

**Fonte:** `src/agent/agent.ts` (método `runLoop`)
**Descrição:** Implementar o loop de conversação que alterna entre chamadas LLM e execução de tools até não haver mais tool_calls pendentes.

**Critério de pronto:**
- Loop itera corretamente entre LLM call → tool execution → LLM call
- Suporta streaming e non-streaming
- Tools parallel-safe executam concorrentemente
- Loop encerra quando resposta é texto sem tool_calls

**Confiança:** 🟢

---

### T-AG-02: Streaming Handler 🟢

**Fonte:** `src/agent/agent.ts` (bloco `for await` dentro de `runLoop`)
**Descrição:** Implementar consumo de SSE chunks com acumulação de text, reasoning_content e tool_calls parciais.

**Critério de pronto:**
- Chunks de texto exibidos incrementalmente
- reasoning_content acumulado e preservado na mensagem final
- tool_calls parciais acumulados por index até completion
- Funciona com abort signal

**Confiança:** 🟢

---

### T-AG-03: checkAndExecuteTool 🟢

**Fonte:** `src/agent/agent.ts` (método `checkAndExecuteTool`)
**Descrição:** Implementar validação de permissões, execução de hooks Pre/Post, e dispatch da tool.

**Critério de pronto:**
- Valida mode (plan blocks writes, build confirms destructive, auto permite tudo)
- Executa PreToolUse hooks e respeita retorno "block"
- Executa tool com args validados
- Push no undoStack para write/patch
- PostToolUse fire-and-forget

**Confiança:** 🟢

---

### T-AG-04: LLM Client Factory 🟢

**Fonte:** `src/agent/llmClient.ts`
**Descrição:** Implementar factory que cria instância OpenAI SDK configurada por provider.

**Critério de pronto:**
- DeepSeek: OpenAI SDK → api.deepseek.com com API key
- Bedrock V3.x: SigV4 signing via bedrock-mantle Chat Completions
- Bedrock R1: InvokeModel com tool emulation no prompt
- Vertex: OAuth2 + aiplatform endpoint (non-streaming only)
- Local: OpenAI SDK → localhost:11434/v1
- Proxy: OpenAI SDK → localhost:{port}/v1

**Confiança:** 🟢

---

### T-AG-05: Steering Loader 🟢

**Fonte:** `src/agent/steering.ts`
**Descrição:** Implementar carregamento e concatenação de arquivos steering ao system prompt.

**Critério de pronto:**
- Carrega `.deepseek/steering/*.md` (glob, sorted)
- Carrega `DEEPSEEK.md` e `.deepseek/DEEPSEEK.md`
- Concatena com separadores
- Injeção no system prompt funcional

**Confiança:** 🟢

---

### T-AG-06: Auto-Compact 🟢

**Fonte:** `src/services/compact/autoCompact.ts`
**Descrição:** Implementar compactação automática com threshold, summary prompt e circuit breaker.

**Critério de pronto:**
- Trigger em `contextUsage/contextLimit > 0.85`
- Envia histórico com prompt de sumarização ao LLM
- Insere boundary marker + summary no histórico
- Circuit breaker: 3 falhas consecutivas → desativa
- Threshold configurável via settings

**Confiança:** 🟢

---

### T-AG-07: MicroCompact 🟢

**Fonte:** `src/services/compact/autoCompact.ts` (seção micro)
**Descrição:** Implementar truncamento de tool results antigos (preserva últimos 5).

**Critério de pronto:**
- Identifica mensagens com role=tool no histórico
- Mantém as 5 mais recentes intactas
- Substitui content das anteriores por placeholder "[truncated]"
- Executa antes do auto-compact check

**Confiança:** 🟢

---

### T-AG-08: Compact Boundary 🟢

**Fonte:** `src/agent/compactBoundary.ts`
**Descrição:** Implementar sistema de boundary markers para delimitar contexto compactado.

**Critério de pronto:**
- `createBoundaryMarker()` insere mensagem system com `__compact_boundary__`
- `getMessagesAfterBoundary()` retorna system prompt + mensagens pós-último boundary
- Múltiplas compactações em cascata funcionam (último boundary vence)

**Confiança:** 🟢

---

### T-AG-09: Session Manager 🟢

**Fonte:** `src/agent/session.ts`
**Descrição:** Implementar persistência de sessões em JSON com prune automático.

**Critério de pronto:**
- Save: serializa state → `~/.deepseek/sessions/{id}.json`
- Load: deserializa e restaura state
- List: retorna sessões ordenadas por updatedAt
- Prune: remove mais antigas quando count > 50
- Campos: id, cwd, model, provider, messages, filesModified, createdAt, updatedAt

**Confiança:** 🟢

---

### T-AG-10: Checkpoint Manager 🟢

**Fonte:** `src/agent/checkpoint.ts`
**Descrição:** Implementar snapshots pontuais com save/load/prune.

**Critério de pronto:**
- Save: snapshot com ID `{timestamp}-{randomHex4}`
- Load: restaura messages + filesModified + model
- Prune: remove mais antigos quando count > 20
- Lista checkpoints disponíveis com label e timestamp

**Confiança:** 🟢

---

### T-AG-11: Undo Stack 🟢

**Fonte:** `src/agent/agent.ts` (propriedade `undoStack`)
**Descrição:** Implementar stack FIFO de escritas em arquivo para undo.

**Critério de pronto:**
- Push: armazena {path, previousContent} em cada write/patch
- Pop: restaura último arquivo
- Max 10 entries (FIFO — remove mais antigo ao exceder)
- /undo consome um entry e restaura o arquivo

**Confiança:** 🟢

---

### T-AG-12: Retry com Backoff 🟢

**Fonte:** `src/agent/agent.ts` (bloco try/catch no LLM call)
**Descrição:** Implementar retry com backoff exponencial para erros transientes.

**Critério de pronto:**
- Retenta em HTTP 429 e 503
- Delays: 1s, 2s, 4s (3 tentativas max)
- NÃO retenta se abort signal ativo
- NÃO retenta em outros HTTP errors (400, 401, etc.)

**Confiança:** 🟢

---

### T-AG-13: Audit Logger 🟢

**Fonte:** `src/agent/auditLog.ts`
**Descrição:** Implementar logging JSONL append-only.

**Critério de pronto:**
- Arquivo: `~/.deepseek/logs/session-{id}.jsonl`
- Append: `JSON.stringify(event) + "\n"` sem buffer
- Eventos: session_start, tool_call, tool_result, compact, checkpoint, session_end, mcp_server_load
- Cada evento tem: ts (ISO), type, dados específicos

**Confiança:** 🟢

---

### T-AG-14: MCP Integration 🟢

**Fonte:** `src/agent/mcp.ts`
**Descrição:** Implementar carregamento de tools de servidores MCP com segurança.

**Critério de pronto:**
- Conecta via stdio ou HTTP Streamable
- Lista tools do server e adiciona ao registry
- Bloqueia env vars: PATH, LD_PRELOAD, HOME, NODE_OPTIONS, LD_LIBRARY_PATH
- Bloqueia injection patterns em commands: `;`, `&&`, `||`, `|`, backtick, `$(`, `\n`
- Bloqueia path traversal: `..`

**Confiança:** 🟢

---

### T-AG-15: Cost Estimator 🟢

**Fonte:** `src/agent/cost.ts`
**Descrição:** Implementar cálculo de custo monetário por modelo e tipo de token.

**Critério de pronto:**
- Pricing table configurável por modelo
- Calcula: (input_tokens × input_rate) + (cached_tokens × cached_rate) + (output_tokens × output_rate)
- Retorna breakdown e total
- Suporta modelos: deepseek-chat, deepseek-reasoner, deepseek-v4-flash, deepseek-v4-pro

**Confiança:** 🟢

---

### T-AG-16: Custom Agent Config 🟢

**Fonte:** `src/agent/config.ts`
**Descrição:** Implementar carregamento e aplicação de agentes custom.

**Critério de pronto:**
- Busca em `.deepseek/agents/` (local) e `~/.deepseek/agents/` (global)
- Lista agentes disponíveis
- Aplica: model override, systemPrompt replace, allowedTools filter
- Carrega files listados no config e injeta no contexto

**Confiança:** 🟢

---

## Ordem de Implementação Sugerida

```
T-AG-04 (LLM Client)
  → T-AG-05 (Steering)
    → T-AG-01 (Loop Principal)
      → T-AG-02 (Streaming)
      → T-AG-03 (checkAndExecuteTool)
        → T-AG-11 (Undo Stack)
      → T-AG-12 (Retry)
  → T-AG-08 (Boundary)
    → T-AG-07 (MicroCompact)
    → T-AG-06 (Auto-Compact)
  → T-AG-09 (Session)
  → T-AG-10 (Checkpoint)
  → T-AG-13 (Audit)
  → T-AG-14 (MCP)
  → T-AG-15 (Cost)
  → T-AG-16 (Custom Agents)
```

---

## Estimativa de Complexidade

| Task | Complexidade | LOC estimado |
|------|-------------|--------------|
| T-AG-01 | Alta | ~200 |
| T-AG-02 | Média | ~80 |
| T-AG-03 | Alta | ~120 |
| T-AG-04 | Média | ~80 |
| T-AG-05 | Baixa | ~40 |
| T-AG-06 | Média | ~60 |
| T-AG-07 | Baixa | ~30 |
| T-AG-08 | Baixa | ~25 |
| T-AG-09 | Média | ~70 |
| T-AG-10 | Média | ~50 |
| T-AG-11 | Baixa | ~30 |
| T-AG-12 | Baixa | ~25 |
| T-AG-13 | Baixa | ~35 |
| T-AG-14 | Média | ~80 |
| T-AG-15 | Baixa | ~40 |
| T-AG-16 | Baixa | ~50 |
| **Total** | — | **~1015** |
