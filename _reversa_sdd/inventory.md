# Inventário — deepseek-code

> Gerado pelo Scout (Reversa) em 2026-06-23

---

## Visão Geral

| Atributo | Valor |
|----------|-------|
| **Nome** | deepseek-code |
| **Versão** | 0.1.0 |
| **Licença** | Apache-2.0 |
| **Linguagem principal** | TypeScript (TSX/TS) |
| **Runtime** | Bun (>=1.0) / Node.js (>=18) |
| **Tipo de projeto** | CLI interativa de IA (TUI) |
| **Linhas de código (src/)** | ~35.800 |
| **Arquivos fonte** | 295 (.ts/.tsx) |
| **Arquivos de teste** | 55 |

---

## Estrutura de Pastas Principal

```
deepseek-code/
├── src/
│   ├── agent/               # Core do agente LLM (loop, providers, tools)
│   │   ├── providers/
│   │   │   ├── bedrock.ts   # AWS Bedrock provider
│   │   │   ├── vertex.ts    # Google Vertex AI provider
│   │   │   └── proxy/       # Proxy server (Hono) que expõe API OpenAI-compatible
│   │   │       ├── browser/ # Playwright headless para OAuth/sessões
│   │   │       ├── formatters/ # Conversão Anthropic ↔ OpenAI
│   │   │       ├── middleware/ # Auth, CORS, rate-limit, logger, error-handler
│   │   │       ├── routes/  # Rotas OpenAI e Anthropic
│   │   │       ├── services/ # Cache, history, orchestrator, model-resolver, retry
│   │   │       ├── tools/   # Tool executor, prompt-emulation, registry, schema
│   │   │       └── types/   # Tipos do proxy
│   │   ├── agent.ts         # Loop principal do agente
│   │   ├── llmClient.ts     # Factory de clientes OpenAI por provider
│   │   ├── mcp.ts           # Integração MCP (Model Context Protocol)
│   │   ├── steering.ts      # System prompt + DEEPSEEK.md loader
│   │   ├── config.ts        # Configuração de agentes custom
│   │   ├── session.ts       # Gerenciamento de sessões
│   │   ├── checkpoint.ts    # Save/load de checkpoints
│   │   ├── compactBoundary.ts # Compactação de contexto
│   │   ├── cost.ts          # Estimativa de custo por tokens
│   │   ├── history.ts       # Histórico de conversas
│   │   └── auditLog.ts      # Log de auditoria
│   ├── commands/            # Slash commands (/model, /plan, /review, /vim, etc.)
│   ├── constants/           # Constantes do produto, agent, tools, UI
│   ├── context/             # AppContext React
│   ├── entrypoints/         # Entry points: cli.tsx (TUI) e pipe.ts (headless)
│   ├── hooks/               # Sistema de hooks (Pre/PostToolUse, SessionStart)
│   ├── ink/                 # Fork customizado do Ink (React TUI renderer)
│   │   ├── components/      # Box, Text, Button, ScrollBox, Link, etc.
│   │   ├── events/          # Sistema de eventos (click, focus, keyboard, paste)
│   │   ├── hooks/           # React hooks (useInput, useInterval, useSelection)
│   │   ├── layout/          # Engine de layout (Yoga-based)
│   │   └── termio/          # Parser e tokenizer de ANSI/SGR/CSI
│   ├── native-ts/           # Yoga Layout bindings em TS puro
│   ├── permissions/         # Sistema de permissões (allow/deny patterns)
│   ├── screens/             # Telas: REPL e Setup
│   ├── services/            # Serviços (compact, mcp, session)
│   ├── settings/            # Carregamento e merge de settings (user/project/local)
│   ├── state/               # State management (store + selectors)
│   ├── tools/               # Ferramentas do agente
│   │   ├── Git/             # Git operations
│   │   ├── Glob/            # File globbing
│   │   ├── Grep/            # Text search
│   │   ├── Introspect/      # Self-inspection
│   │   ├── PatchFile/       # Edição parcial de arquivos
│   │   ├── ReadFile/        # Leitura de arquivos
│   │   ├── ReadFolder/      # Listagem de diretórios
│   │   ├── Shell/           # Execução de comandos shell
│   │   ├── SubAgent/        # Sub-agentes
│   │   ├── Todo/            # Gerenciamento de tarefas
│   │   ├── UpdateKnowledge/ # Atualização de knowledge base
│   │   ├── WebFetch/        # Busca web
│   │   └── WriteFile/       # Escrita de arquivos
│   ├── types/               # Tipos globais (message, provider, permissions)
│   ├── ui/                  # Componentes UI da aplicação
│   │   ├── input/           # InputBox, cursor, ghost hints, vim mode
│   │   ├── layout/          # StatusBar, WelcomeScreen
│   │   ├── messages/        # MessageList, DiffView, MarkdownText, ToolUseDisplay
│   │   └── setup/           # ApiKeySetup, ModelSelector, ThemeSelector
│   └── utils/               # Utilitários (credentials, fs, semver, env, debug)
├── tests/                   # Testes unitários (Vitest via Bun)
├── deepseek-code-public/    # Build público (README, imagens, cli.mjs compilado)
├── .deepseek/               # Config e logs locais do agente
├── .github/workflows/       # CI (GitHub Actions)
├── build.ts                 # Script de build (Bun.build)
├── bunfig.toml              # Configuração Bun
├── vitest.config.ts         # Configuração Vitest
├── tsconfig.json            # Configuração TypeScript
└── package.json             # Manifest do projeto
```

---

## Entry Points

| Arquivo | Propósito |
|---------|-----------|
| `src/index.tsx` | Entry principal — delega para `entrypoints/cli.tsx` |
| `src/entrypoints/cli.tsx` | CLI TUI completa (React + Ink) |
| `src/entrypoints/pipe.ts` | Modo pipe (headless, stdin/stdout) |
| `src/agent/providers/proxy/start.ts` | Servidor proxy local (Hono) |
| `build.ts` | Script de build (gera `dist/cli.mjs` + wrapper shell) |

---

## CI/CD

- **GitHub Actions**: `.github/workflows/ci.yml`
  - Trigger: push/PR para `main`
  - Steps: checkout → setup Bun 1.3.13 → install → typecheck → test

---

## Banco de Dados

Nenhum banco de dados relacional identificado. O estado é gerenciado via:
- Arquivos JSON em `~/.deepseek/` (config, sessions, logs)
- Session JSONL logs em `~/.deepseek/logs/`

---

## Configuração

| Arquivo | Propósito |
|---------|-----------|
| `bunfig.toml` | Aliases de build e resolução |
| `tsconfig.json` | ESNext + JSX react-jsx + strict |
| `vitest.config.ts` | Timeouts de teste (15s) |
| `.env.uau` | Variáveis de ambiente (não commitado em prod) |
| `.deepseek/agents/coder.json` | Agente custom "coder" |

---

## Cobertura de Testes

| Framework | Arquivos | Localização |
|-----------|----------|-------------|
| Vitest (via `bun test`) | 55 | `tests/` |

Áreas cobertas: agent loop, providers (bedrock, vertex, proxy), tools (patch, write, fetch), commands, UI hooks (vim, input, paste), streaming, session, cost, steering.
