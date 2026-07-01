# C4 Context Diagram (Level 1)

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## System Context

```mermaid
C4Context
    title DeepSeek Code — System Context

    Person(user, "Developer", "Uses CLI/TUI to interact with AI coding assistant")
    Person(mobile_user, "Mobile User", "Controls session remotely via phone")

    System(deepseek_code, "DeepSeek Code", "AI-powered coding assistant CLI/TUI built with Bun + React + Ink")

    System_Ext(deepseek_api, "DeepSeek API", "LLM inference (deepseek-chat, deepseek-v4-flash, deepseek-v4-pro)")
    System_Ext(aws_bedrock, "AWS Bedrock", "DeepSeek R1 and V3.x models via AWS")
    System_Ext(gcp_vertex, "Google Vertex AI", "DeepSeek models via GCP")
    System_Ext(local_llm, "Local LLM Server", "Ollama or LM Studio running local models")
    System_Ext(deepseek_browser, "DeepSeek Browser API", "Browser-based chat interface accessed via Playwright")
    System_Ext(relay_server, "WebSocket Relay", "Zero-knowledge relay for E2E encrypted remote control")
    System_Ext(filesystem, "Local Filesystem", "Project files, configs, git repos")
    System_Ext(web, "External Web", "URLs fetched by web_fetch tool")
    System_Ext(mcp_servers, "MCP Servers", "External tool providers via Model Context Protocol")

    Rel(user, deepseek_code, "Sends prompts, receives responses", "Terminal I/O")
    Rel(mobile_user, relay_server, "Sends commands", "WebSocket + E2E encryption")
    Rel(relay_server, deepseek_code, "Relays frames", "WebSocket")

    Rel(deepseek_code, deepseek_api, "Chat completions", "HTTPS / OpenAI SDK")
    Rel(deepseek_code, aws_bedrock, "InvokeModel / Chat Completions", "AWS SDK")
    Rel(deepseek_code, gcp_vertex, "Predict", "GCP SDK")
    Rel(deepseek_code, local_llm, "Chat completions", "HTTP / OpenAI-compatible")
    Rel(deepseek_code, deepseek_browser, "Browser automation", "Playwright / Hono proxy")
    Rel(deepseek_code, filesystem, "Read/Write/Execute", "Node.js fs + child_process")
    Rel(deepseek_code, web, "HTTP GET", "fetch with SSRF protection")
    Rel(deepseek_code, mcp_servers, "Tool discovery + execution", "MCP protocol")
```

## Actors

| Actor | Type | Description |
|-------|------|-------------|
| Developer | Human | Primary user — interacts via terminal (keyboard input, visual output) |
| Mobile User | Human | Secondary — controls session from phone via QR-paired remote |

## External Systems

| System | Protocol | Purpose |
|--------|----------|---------|
| DeepSeek API | HTTPS (OpenAI SDK format) | Primary LLM provider — native API key auth |
| AWS Bedrock | AWS SDK (InvokeModel / Chat Completions) | Cloud LLM — DeepSeek R1, V3.x models |
| Google Vertex AI | GCP SDK (Predict) | Cloud LLM — DeepSeek models |
| Local LLM Server | HTTP (OpenAI-compatible) | Self-hosted via Ollama / LM Studio |
| DeepSeek Browser API | Playwright page pool → Hono proxy | Browser-based DeepSeek access |
| WebSocket Relay | WebSocket + Curve25519/XSalsa20 | Zero-knowledge relay for remote control |
| Local Filesystem | POSIX fs | Project files, git repos, configs |
| External Web | HTTPS | URLs fetched by web_fetch tool (SSRF-protected) |
| MCP Servers | MCP protocol | External tools (stdio/SSE transport) |
