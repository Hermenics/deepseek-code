# Contracts — Módulo Agent

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Contrato 1: OpenAI-Compatible Chat Completions (Outbound) 🟢

O Agent consome a API de todos os providers via interface OpenAI-compatible.

### Request

```
POST /v1/chat/completions
Content-Type: application/json
Authorization: Bearer {api_key}
```

```json
{
  "model": "deepseek-chat",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "...", "reasoning_content": "...", "tool_calls": [...] },
    { "role": "tool", "tool_call_id": "...", "content": "..." }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "write_file",
        "description": "...",
        "parameters": { "type": "object", "properties": {...} }
      }
    }
  ],
  "stream": true,
  "temperature": 0
}
```

### Response (Streaming)

```
data: {"id":"...","choices":[{"delta":{"content":"..."}}]}
data: {"id":"...","choices":[{"delta":{"reasoning_content":"..."}}]}
data: {"id":"...","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"...","arguments":"..."}}]}}]}
data: [DONE]
```

### Response (Non-streaming)

```json
{
  "id": "...",
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "...",
      "reasoning_content": "...",
      "tool_calls": [{
        "id": "call_...",
        "type": "function",
        "function": { "name": "write_file", "arguments": "{...}" }
      }]
    },
    "finish_reason": "tool_calls"
  }],
  "usage": {
    "prompt_tokens": 1234,
    "completion_tokens": 567,
    "prompt_cache_hit_tokens": 890
  }
}
```

### Invariantes

- `reasoning_content` DEVE ser preservado e re-enviado em cada request subsequente 🟢
- `tool_call_id` no role=tool DEVE corresponder ao id do tool_call original 🟢
- `stream: true` não suportado para Vertex e Bedrock R1 🟢

---

## Contrato 2: AWS Bedrock InvokeModel (Outbound) 🟢

Usado apenas para Bedrock R1 (sem Chat Completions nativo).

### Request

```
POST /model/{modelId}/invoke
Content-Type: application/json
X-Amz-Date: ...
Authorization: AWS4-HMAC-SHA256 ...
```

```json
{
  "prompt": "<system>...</system>\n<tools>...</tools>\n<human>...</human>",
  "max_tokens": 8192,
  "temperature": 0,
  "stop": ["</response>"]
}
```

### Response

```json
{
  "completion": "<thinking>...</thinking>\n<response>...<tool_use>...</tool_use></response>",
  "stop_reason": "stop"
}
```

### Invariantes

- Tool calls emulados via XML no prompt e parsing na resposta 🟢
- Streaming desabilitado 🟢

---

## Contrato 3: MCP Tool Protocol (Outbound) 🟢

### Transport: stdio

```
spawn(command, args, { env, stdio: "pipe" })
→ stdin: JSON-RPC messages
← stdout: JSON-RPC responses
```

### Handshake

```json
// → Request
{"jsonrpc": "2.0", "method": "initialize", "params": {"capabilities": {}}, "id": 1}
// ← Response
{"jsonrpc": "2.0", "result": {"capabilities": {"tools": true}}, "id": 1}
```

### List Tools

```json
// → Request
{"jsonrpc": "2.0", "method": "tools/list", "id": 2}
// ← Response
{"jsonrpc": "2.0", "result": {"tools": [{"name": "...", "description": "...", "inputSchema": {...}}]}, "id": 2}
```

### Execute Tool

```json
// → Request
{"jsonrpc": "2.0", "method": "tools/call", "params": {"name": "...", "arguments": {...}}, "id": 3}
// ← Response
{"jsonrpc": "2.0", "result": {"content": [{"type": "text", "text": "..."}]}, "id": 3}
```

### Invariantes

- Env vars PATH, LD_PRELOAD, HOME, NODE_OPTIONS bloqueados 🟢
- Timeout: configurável por server (default settings do MCP SDK) 🟡

---

## Contrato 4: Session Persistence (Filesystem) 🟢

### Write

```
Path: ~/.deepseek/sessions/{id}.json
Format: JSON (UTF-8, pretty-printed)
Trigger: Após cada interação completa (user→assistant cycle)
```

### Schema

```json
{
  "id": "string (hex 12)",
  "cwd": "string (absolute path)",
  "model": "string",
  "provider": "string",
  "language": "string | null",
  "activeAgent": "string | null",
  "messages": "Message[]",
  "filesModified": "string[]",
  "createdAt": "string (ISO 8601)",
  "updatedAt": "string (ISO 8601)"
}
```

### Invariantes

- Max 50 files no diretório (prune by updatedAt) 🟢
- Atomic write via temp file + rename 🟡

---

## Contrato 5: Audit Log (Filesystem) 🟢

### Write

```
Path: ~/.deepseek/logs/session-{id}.jsonl
Format: JSONL (uma linha JSON por evento)
Mode: Append-only
```

### Event Schema

```json
{
  "ts": "string (ISO 8601)",
  "type": "session_start | tool_call | tool_result | compact | checkpoint | session_end | mcp_server_load",
  "tool": "string | undefined",
  "durationMs": "number | undefined",
  "details": "object | undefined"
}
```

### Invariantes

- Nunca trunca ou reescreve log existente 🟢
- Um arquivo por sessão 🟢

---

## Contrato 6: Checkpoint Persistence (Filesystem) 🟢

### Write

```
Path: ~/.deepseek/checkpoints/{id}.json
Format: JSON (UTF-8)
ID: {unix_timestamp}-{randomHex4}
```

### Schema

```json
{
  "id": "string",
  "label": "string",
  "timestamp": "string (ISO 8601)",
  "sessionId": "string",
  "messages": "Message[]",
  "filesModified": "string[]",
  "model": "string",
  "provider": "string"
}
```

### Invariantes

- Max 20 files (prune oldest) 🟢
- Restore carrega messages e re-aplica model/provider 🟢
