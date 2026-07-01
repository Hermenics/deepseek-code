# Proxy Module — Tasks

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Tasks for Reimplementation

### T-01: Implement Hono Server Bootstrap
- **Source:** `src/agent/providers/proxy/start.ts`
- **Description:** Create Hono HTTP server with CORS, bind to dynamic port, register OpenAI routes.
- **Done when:** Server starts, accepts requests at `/v1/chat/completions`.
- **Confidence:** 🟢

### T-02: Implement OpenAI Route Handler
- **Source:** `src/agent/providers/proxy/routes/openai.ts`
- **Description:** Parse OpenAI-format request, convert tools, delegate to orchestrator, return SSE stream or JSON response.
- **Done when:** Both streaming and non-streaming paths work with correct OpenAI format.
- **Confidence:** 🟢

### T-03: Implement Orchestrator Service
- **Source:** `src/agent/providers/proxy/services/orchestrator.ts`
- **Description:** Manage request lifecycle: acquire page, validate session, send request, stream response, release page.
- **Done when:** Requests flow through correctly, sessions managed, pages returned to pool.
- **Confidence:** 🟢

### T-04: Implement DeepSeek API Service (Playwright)
- **Source:** `src/agent/providers/proxy/services/deepseek-api.ts`
- **Description:** Page pool management, browser automation for DeepSeek chat, session handling, header caching.
- **Done when:** Pages reused from pool, messages sent via browser, responses streamed back.
- **Confidence:** 🟢

### T-05: Implement Robust JSON Parser
- **Source:** `src/agent/providers/proxy/services/robust-json.ts`
- **Description:** Parse JSON from incomplete/streaming data. Validate unicode escapes. Handle WAF detection.
- **Done when:** Partial JSON recoverable, WAF challenges detected, malformed data handled gracefully.
- **Confidence:** 🟢

### T-06: Implement Prompt-Based Tool Call Parsing
- **Source:** `src/agent/providers/proxy/tools/prompt-emulation.ts`
- **Description:** Parse `<tool_call>` XML from streamed text. Reject if inside code fences. Extract name and args.
- **Done when:** Tool calls correctly parsed, code fence false positives rejected.
- **Confidence:** 🟢
