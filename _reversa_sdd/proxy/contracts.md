# Proxy Module — Contracts

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## HTTP API Contract

### POST /v1/chat/completions

**Request (OpenAI-compatible):**
```json
{
  "model": "deepseek-chat",
  "messages": [
    {"role": "system", "content": "..."},
    {"role": "user", "content": "..."}
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "shell",
        "description": "Execute a shell command",
        "parameters": {"type": "object", "properties": {...}}
      }
    }
  ],
  "stream": true,
  "max_tokens": 32768
}
```

**Response (streaming SSE):**
```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_xxx","type":"function","function":{"name":"shell","arguments":"{\"command\":\"ls\"}"}}]},"finish_reason":"tool_calls"}]}

data: [DONE]
```

**Response (non-streaming):**
```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "Hello",
      "tool_calls": [...]
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 50,
    "total_tokens": 150
  }
}
```

## Internal Protocol: Browser → Proxy

The proxy communicates with DeepSeek browser via Playwright page automation. No formal HTTP contract exists — it's DOM manipulation and event interception.

## Tool Format Translation

| OpenAI Format | DeepSeek Browser Format |
|--------------|------------------------|
| `tools[].function.name` | Injected into prompt as XML `<tool>` |
| `tools[].function.parameters` | Rendered as `<parameters>` children |
| Response: `tool_calls[].function` | Parsed from `<tool_call>` in stream |
