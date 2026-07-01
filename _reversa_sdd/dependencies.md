# Dependencies — deepseek-code

> Confidence: 🟢 CONFIRMED — extracted from `package.json` v0.1.11.

**Generated at:** 2026-07-01  
**Package Manager:** bun (lockfile: `bun.lockb`)  
**Runtime:** Bun >= 1.0 / Node >= 18

## Production Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `react` | ^19.2.0 | UI rendering (terminal React via Ink fork) |
| `react-reconciler` | ^0.33.0 | Custom React reconciler for terminal |
| `hono` | ^4.12.21 | HTTP framework for proxy server |
| `@hono/node-server` | ^1.14.0 | Node.js adapter for Hono |
| `openai` | ^6.34.0 | OpenAI SDK (used for DeepSeek API compatibility) |
| `@modelcontextprotocol/sdk` | ^1.29.0 | MCP (Model Context Protocol) client |
| `playwright` | ^1.50.0 | Browser automation for proxy browser pool |
| `@aws-sdk/client-bedrock` | ^3.1048.0 | AWS Bedrock provider |
| `@aws-sdk/credential-providers` | ^3.1048.0 | AWS credential resolution |
| `@aws-crypto/sha256-js` | ^5.2.0 | SHA-256 for AWS signing |
| `@smithy/protocol-http` | ^5.3.14 | HTTP protocol utilities (AWS) |
| `@smithy/signature-v4` | ^5.3.14 | AWS Signature V4 signing |
| `google-auth-library` | ^10.6.2 | Google Vertex AI authentication |
| `chalk` | ^5.6.2 | Terminal color styling |
| `execa` | ^9.6.1 | Process execution (shell tool) |
| `fast-glob` | ^3.3.3 | File glob matching |
| `fuse.js` | ^7.0.0 | Fuzzy search (command matching) |
| `strip-ansi` | ^7.2.0 | ANSI escape removal |
| `wrap-ansi` | ^10.0.0 | ANSI-aware text wrapping |
| `@alcalzone/ansi-tokenize` | ^0.3.0 | ANSI tokenization |
| `bidi-js` | ^1.0.3 | Bidirectional text support |
| `bignumber.js` | ^11.1.0 | Arbitrary precision arithmetic (cost) |
| `cli-boxes` | ^4.0.1 | Box-drawing characters |
| `code-excerpt` | ^4.0.0 | Code snippet extraction |
| `ecdsa-sig-formatter` | ^1.0.11 | ECDSA signature formatting (OAuth) |
| `emoji-regex` | ^10.6.0 | Emoji detection for text width |
| `get-east-asian-width` | ^1.6.0 | CJK character width detection |
| `indent-string` | ^5.0.0 | String indentation utility |
| `lodash-es` | ^4.18.1 | Utility functions |
| `semver` | ^7.8.1 | Semantic versioning |
| `signal-exit` | ^4.1.0 | Exit signal handling |
| `stack-utils` | ^2.0.6 | Stack trace parsing |
| `supports-hyperlinks` | ^4.4.0 | Terminal hyperlink detection |
| `type-fest` | ^5.6.0 | TypeScript type utilities |
| `usehooks-ts` | ^3.1.1 | React hooks library |
| `auto-bind` | ^5.0.1 | Class method auto-binding |

## Dev Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.9.3 | Type system |
| `vitest` | ^4.1.6 | Test framework |
| `@types/bun` | ^1.3.12 | Bun type definitions |
| `@types/react` | ^19.2.0 | React type definitions |
| `@types/stack-utils` | ^2.0.3 | Stack-utils types |
| `@types/semver` | ^7.7.1 | Semver types |
| `react-devtools-core` | ^7.0.1 | React DevTools (dev only) |

## Provider Dependencies (grouped)

### DeepSeek (primary, via OpenAI SDK)
- `openai` — API client, chat completions, streaming

### AWS Bedrock
- `@aws-sdk/client-bedrock`, `@aws-sdk/credential-providers`
- `@smithy/protocol-http`, `@smithy/signature-v4`
- `@aws-crypto/sha256-js`

### Google Vertex AI
- `google-auth-library`

### Local (Ollama/LM Studio)
- Uses OpenAI-compatible endpoint via `openai` SDK

## Key Architectural Dependencies

| Layer | Dependency | Role |
|-------|-----------|------|
| Runtime | Bun | JS/TS runtime, bundler, test runner |
| UI Framework | React 19 + react-reconciler | Terminal UI rendering |
| Renderer | Ink (forked, in-tree) | Terminal React host |
| HTTP Server | Hono | Proxy API server |
| LLM Client | OpenAI SDK | Primary API communication |
| MCP | @modelcontextprotocol/sdk | Tool/resource protocol |
| Browser | Playwright | Web fetch via browser pool |
| Process | execa | Shell command execution |

## External Integrations

| Integration | Protocol | Used By |
|-------------|----------|---------|
| DeepSeek API | HTTPS (OpenAI-compat) | `proxy/services/deepseek-api.ts` |
| AWS Bedrock | HTTPS (SigV4) | `agent/providers/bedrock.ts` |
| Google Vertex AI | HTTPS (OAuth2) | `agent/providers/vertex.ts` |
| MCP Servers | stdio/SSE | `services/mcp/client.ts` |
| Git | CLI | `tools/Git/Git.ts` |
| Filesystem | OS | `tools/ReadFile`, `WriteFile`, `PatchFile` |
