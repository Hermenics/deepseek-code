# Proxy Module — Requirements

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Overview

The Proxy module provides a Hono HTTP server that translates OpenAI/Anthropic-compatible API requests into DeepSeek browser API calls via a Playwright page pool. It enables using DeepSeek's browser-based chat as an LLM provider.

## Functional Requirements

### FR-01: OpenAI-Compatible HTTP Endpoint 🟢
- **Must** expose `/v1/chat/completions` endpoint accepting OpenAI format
- **Must** support streaming (SSE) and non-streaming responses
- **Must** translate between OpenAI tool format and DeepSeek format

### FR-02: Browser Automation 🟢
- **Must** manage a Playwright page pool for concurrent requests
- **Must** handle DeepSeek browser session authentication
- **Must** detect and recover from WAF challenges

### FR-03: Tool Call Detection 🟢
- **Must** parse `<tool_call>` XML tags from streamed responses
- **Must** support mid-stream JSON parsing for robust tool call detection
- **Must** reject tool calls found inside inline code fences (false positives)

### FR-04: Robust JSON Parsing 🟢
- **Must** handle incomplete/malformed JSON in streaming responses
- **Must** validate `\uXXXX` escape sequences
- **Must** recover from partial responses

### FR-05: Session Management 🟢
- **Should** cache and reuse browser sessions
- **Should** refresh sessions in background before expiry
- **Must** validate session before use

## Non-Functional Requirements

### NFR-01: Performance 🟡
- Page pool size determines concurrent request capacity
- Header caching reduces per-request overhead

### NFR-02: Reliability 🟡
- WAF detection and retry mechanism
- Session validation before request execution

## Acceptance Criteria

### AC-01: Streaming Response
```
Given a valid chat completion request
When sent to /v1/chat/completions with stream=true
Then SSE events are streamed back in OpenAI delta format
And tool calls are correctly extracted from XML tags
```

### AC-02: Tool Call in Code Fence
```
Given a response containing <tool_call> inside a markdown code block
When the response is parsed
Then the tool call is NOT extracted (false positive rejection)
```
