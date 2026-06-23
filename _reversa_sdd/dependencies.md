# Dependências — deepseek-code

> Gerado pelo Scout (Reversa) em 2026-06-23

---

## Runtime & Build

| Ferramenta | Versão | Papel |
|------------|--------|-------|
| Bun | >=1.0 (CI: 1.3.13) | Runtime, bundler, test runner |
| Node.js | >=18 | Compatibilidade (engines) |
| TypeScript | ^5.9.3 | Type checking (bunx tsc) |

---

## Dependências de Produção

### Core LLM & AI

| Pacote | Versão | Propósito |
|--------|--------|-----------|
| `openai` | ^6.34.0 | Cliente OpenAI-compatible (usado para DeepSeek API, Bedrock, Vertex, Local) |
| `@modelcontextprotocol/sdk` | ^1.29.0 | MCP client (stdio + streamable HTTP) |

### AWS (Bedrock Provider)

| Pacote | Versão | Propósito |
|--------|--------|-----------|
| `@aws-sdk/client-bedrock` | ^3.1048.0 | Bedrock InvokeModel |
| `@aws-sdk/credential-providers` | ^3.1048.0 | AWS credential resolution |
| `@aws-crypto/sha256-js` | ^5.2.0 | SigV4 signing |
| `@smithy/protocol-http` | ^5.3.14 | HTTP protocol utilities |
| `@smithy/signature-v4` | ^5.3.14 | AWS Signature V4 |

### Google Cloud (Vertex Provider)

| Pacote | Versão | Propósito |
|--------|--------|-----------|
| `google-auth-library` | ^10.6.2 | GCP authentication |

### Web Server (Proxy)

| Pacote | Versão | Propósito |
|--------|--------|-----------|
| `hono` | ^4.12.21 | HTTP framework (proxy server) |
| `@hono/node-server` | ^1.14.0 | Node.js adapter para Hono |

### Browser Automation

| Pacote | Versão | Propósito |
|--------|--------|-----------|
| `playwright` | ^1.50.0 | Headless Chromium (OAuth, sessões web) |

### UI / TUI (Ink fork)

| Pacote | Versão | Propósito |
|--------|--------|-----------|
| `react` | ^19.2.0 | React core (JSX/componentes) |
| `react-reconciler` | ^0.33.0 | Custom renderer para terminal |
| `chalk` | ^5.6.2 | Coloração ANSI |
| `cli-boxes` | ^4.0.1 | Box drawing characters |
| `wrap-ansi` | ^10.0.0 | Word wrap com ANSI |
| `strip-ansi` | ^7.2.0 | Remove códigos ANSI |
| `indent-string` | ^5.0.0 | Indentação de strings |
| `emoji-regex` | ^10.6.0 | Detecção de emojis (medição de largura) |
| `get-east-asian-width` | ^1.6.0 | Largura de caracteres CJK |
| `supports-hyperlinks` | ^4.4.0 | Detecção de suporte a hyperlinks no terminal |
| `bidi-js` | ^1.0.3 | Suporte a texto bidirecional |
| `code-excerpt` | ^4.0.0 | Exibição de trechos de código |

### Utilidades

| Pacote | Versão | Propósito |
|--------|--------|-----------|
| `execa` | ^9.6.1 | Execução de processos child |
| `fast-glob` | ^3.3.3 | File globbing performante |
| `fuse.js` | ^7.0.0 | Fuzzy search (commands, files) |
| `lodash-es` | ^4.18.1 | Utilidades JS |
| `semver` | ^7.8.1 | Versionamento semântico |
| `signal-exit` | ^4.1.0 | Exit handlers |
| `stack-utils` | ^2.0.6 | Stack trace parsing |
| `type-fest` | ^5.6.0 | Tipos utilitários TS |
| `usehooks-ts` | ^3.1.1 | React hooks extras |
| `auto-bind` | ^5.0.1 | Auto-binding de métodos |
| `bignumber.js` | ^11.1.0 | Aritmética de precisão (custos) |
| `ecdsa-sig-formatter` | ^1.0.11 | Formatação de assinatura JWT |

---

## Dependências de Desenvolvimento

| Pacote | Versão | Propósito |
|--------|--------|-----------|
| `@types/bun` | ^1.3.12 | Tipos Bun |
| `@types/react` | ^19.2.0 | Tipos React |
| `@types/stack-utils` | ^2.0.3 | Tipos stack-utils |
| `@types/semver` | ^7.7.1 | Tipos semver |
| `react-devtools-core` | ^7.0.1 | Dev tools (stubbed em prod via alias) |
| `typescript` | ^5.9.3 | Compilador TS |
| `vitest` | ^4.1.6 | Test framework (executado via `bun test`) |

---

## Gerenciador de Pacotes

- **Bun** (primário) — `bun.lock` presente
- `package-lock.json` também presente (compatibilidade npm)

---

## Integrações Externas

| Serviço | Como é acessado | Configuração |
|---------|-----------------|--------------|
| DeepSeek API | OpenAI SDK → `api.deepseek.com` | `DEEPSEEK_API_KEY` |
| AWS Bedrock | SigV4 fetch → `bedrock-runtime.*.amazonaws.com` | AWS profile/region |
| Google Vertex AI | OAuth2 → `*-aiplatform.googleapis.com` | GCP service account JSON |
| Local LLM (Ollama/LM Studio) | OpenAI SDK → `localhost:11434/v1` | `localBaseUrl` config |
| MCP Servers | stdio ou HTTP Streamable | `.deepseek/mcp.json` |
| npm Registry | fetch | Auto-update check |
