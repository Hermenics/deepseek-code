# Proxy Module — Design

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Architecture

The Proxy is a standalone Hono HTTP server that acts as a translation layer between OpenAI-compatible clients and DeepSeek's browser-based API. It uses Playwright for browser automation.

## Components

```
proxy/
├── start.ts              — Server bootstrap
├── routes/
│   └── openai.ts         — /v1/chat/completions route handler
├── services/
│   ├── orchestrator.ts   — Request routing, session mgmt, streaming
│   ├── deepseek-api.ts   — Playwright page pool, browser automation
│   └── robust-json.ts    — Mid-stream JSON parser, WAF handling
└── tools/
    └── prompt-emulation.ts — <tool_call> XML parsing from stream
```

## Key Algorithms

### Stream Processing Pipeline
```
Incoming request (OpenAI format)
  → Convert tools to DeepSeek format
  → Acquire page from pool
  → Send to DeepSeek browser
  → Stream response chunks
    → For each chunk:
      → Robust JSON parse (handle partial)
      → Check for <tool_call> XML (not in code fences)
      → Emit as OpenAI SSE delta
  → Release page back to pool
```

### Tool Call Detection
```
For each streamed text chunk:
  if inside_code_fence: skip
  if matches <tool_call>...<name>X</name>...<args>Y</args>...</tool_call>:
    parse name and args
    emit as tool_call delta in OpenAI format
  else:
    emit as content delta
```

## Data Flow

```
Client (Agent) ──HTTP──→ Hono Server ──Playwright──→ DeepSeek Browser
                  ↑                                        │
                  └──────── SSE stream ←───────────────────┘
```

## Error Handling

| Error | Handling |
|-------|----------|
| WAF challenge | Detect, retry with fresh page |
| Session expired | Refresh in background, retry |
| Malformed JSON | Robust parser recovers partial data |
| Page pool exhausted | Queue request until page available |
