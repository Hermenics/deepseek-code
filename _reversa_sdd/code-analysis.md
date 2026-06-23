# Análise de Código — deepseek-code

> Gerado pelo Arqueólogo (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Módulo: agent

**Caminho:** `src/agent/`
**Propósito:** Core do agente LLM — loop de conversação, client factory, steering, sessões, checkpoints, compactação, custo e auditoria.

### Classe Principal: `Agent`

🟢 CONFIRMADO — `src/agent/agent.ts`

**Responsabilidades:**
- Gerencia o loop de conversação (streaming + non-streaming)
- Controle de permissões por interaction mode (plan/build/auto)
- Execução de tools com validação de argumentos
- Auto-compact quando contexto atinge threshold (85%)
- MicroCompact: trunca tool results antigos
- Undo stack para file writes (máx 10 entries)
- Retry com backoff exponencial (1s, 2s, 4s) em HTTP 429/503
- Hooks (Pre/PostToolUse, SessionStart)
- Parallel tool execution para tools read-only

**Fluxo principal (`run` → `loop` → `runLoop`):**
1. Aguarda inicialização assíncrona (`readyPromise`)
2. MicroCompact em mensagens antigas
3. Auto-compact se `contextUsage/contextLimit > 0.85`
4. Injeta mensagem do usuário + pending notes
5. Entra no loop:
   - Monta `apiMessages` a partir do histórico (pós-boundary)
   - Se `!useStreaming`: chamada síncrona → processa tool calls ou resposta final
   - Se streaming: consome chunks via `for await` → acumula texto, reasoning, tool_calls
   - Executa tools (paralelo se safe, sequencial caso contrário)
   - Loop continua até não haver mais tool_calls

**Inicialização (`initialize`):**
1. Carrega em paralelo: steering, DEEPSEEK.md, settings, MCP tools
2. Injeta steering no system prompt
3. Para Bedrock R1 (sem tool calling nativo): injeta tool definitions no prompt
4. Executa SessionStart hooks

### Providers

| Provider | Arquivo | Mecanismo | Tool Calling |
|----------|---------|-----------|--------------|
| DeepSeek (nativo) | `llmClient.ts` | OpenAI SDK → `api.deepseek.com` | 🟢 Nativo |
| AWS Bedrock V3.x | `providers/bedrock.ts` | SigV4 → bedrock-mantle | 🟢 Nativo (Chat Completions) |
| AWS Bedrock R1 | `providers/bedrock.ts` | SigV4 → InvokeModel | 🟡 Prompt-based (XML parsing) |
| Google Vertex AI | `providers/vertex.ts` | OAuth2 → aiplatform endpoint | 🟡 Non-streaming only |
| Local (Ollama etc) | `llmClient.ts` | OpenAI SDK → localhost | 🟢 Nativo |
| Proxy | `providers/proxy/` | Hono server + Playwright | 🟢 Via orchestrator |

### Proxy Server (`providers/proxy/`)

🟢 CONFIRMADO — Servidor HTTP local (Hono) que faz bridge entre API OpenAI-compatible e o DeepSeek web.

**Componentes:**
- **Browser pool** — Playwright headless Chromium com pool de páginas pré-aquecidas
- **Orchestrator** — Converte mensagens OpenAI → prompt DeepSeek nativo, retransmite SSE
- **Routes** — `/v1/chat/completions` (OpenAI) e `/v1/messages` (Anthropic-compat)
- **Formatters** — Conversão bidirecional Anthropic ↔ OpenAI
- **Middleware** — Auth (API key), CORS, rate-limit, request-logger, error-handler
- **Services** — Cache, history, model-resolver, retry, session-manager, validator, output-sanitizer
- **Tools** — Executor, prompt-emulation (XML tool_call parsing), registry, schema

### Custo (`cost.ts`)

🟢 CONFIRMADO — Pricing table (Apr 2026):

| Modelo | Input/1M | Cached/1M | Output/1M |
|--------|----------|-----------|-----------|
| deepseek-chat | $0.27 | $0.07 | $1.10 |
| deepseek-reasoner | $0.55 | $0.14 | $2.19 |
| deepseek-v4-flash | $0.27 | $0.07 | $1.10 |
| deepseek-v4-pro | $0.55 | $0.14 | $2.19 |

### Sessões (`session.ts`)

🟢 CONFIRMADO — Persistência JSON em `~/.deepseek/sessions/`. Max 50 sessões (prune por data). Campos: id, cwd, model, provider, messages, filesModified.

### Checkpoint (`checkpoint.ts`)

🟢 CONFIRMADO — Snapshot do estado de conversação. Max 20 no disco. ID = `timestamp-randomHex`. Inclui messages e filesModified.

### CompactBoundary (`compactBoundary.ts`)

🟢 CONFIRMADO — Marcador especial (`__compact_boundary__`) que delimita contexto compactado. `getMessagesAfterBoundary` retorna apenas mensagens após o último boundary + system prompt.

### Audit Log (`auditLog.ts`)

🟢 CONFIRMADO — JSONL append-only em `~/.deepseek/logs/session-{id}.jsonl`. Eventos: session_start, tool_call, tool_result, compact, checkpoint, session_end, mcp_server_load.

### Steering (`steering.ts`)

🟢 CONFIRMADO — Carrega `.deepseek/steering/*.md` e `DEEPSEEK.md` (raiz + `.deepseek/`). Concatena ao system prompt.

### Agentes Custom (`config.ts`)

🟢 CONFIRMADO — JSON em `.deepseek/agents/{name}.json` (local) ou `~/.deepseek/agents/` (global). Campos: name, model, systemPrompt, files, allowedTools.

---

## Módulo: tools

**Caminho:** `src/tools/`
**Propósito:** 13 ferramentas que o agente pode invocar durante a conversação.

### Interface Tool

🟢 CONFIRMADO — `{ name, description, parameters, execute(args): Promise<string> }`

### Catálogo

| Tool | Tipo | Segurança |
|------|------|-----------|
| `write_file` | Escrita | `assertSafePath` + undo snapshot |
| `patch_file` | Escrita parcial | `assertSafePath` + undo snapshot |
| `read_file` | Leitura | `assertSafePath` |
| `read_folder` | Leitura | `assertSafePath` |
| `grep` | Busca | Path safety |
| `glob` | Busca | `BLOCKED_GLOB_PATTERNS` |
| `shell` | Execução | Destructive pattern check + confirm handler |
| `git` | VCS | Force-push usa `--force-with-lease` |
| `web_fetch` | Rede | SSRF protection (blocks private/metadata IPs) |
| `subagent` | Sub-agente | Herda permissions, max 15 iterations |
| `todo` | UI | Sem restrição |
| `introspect` | Meta | Sem restrição |
| `update_knowledge` | Persistência | Sem restrição |

### Segurança: `pathSafety.ts`

🟢 CONFIRMADO — Sistema de proteção de caminhos:
1. Path deve estar dentro do `cwd`
2. Symlink traversal bloqueado (via `realpath`)
3. Diretórios bloqueados: `.agent`, `.claude`, `.kiro`, `.github`, `.deepseek`, `node_modules`, `dist`, `build`, `.git`
4. Arquivos sensíveis bloqueados: `.env*`, `*.pem`, `*.key`, `credentials.*`, `secrets.*`, SSH keys, AWS/GCP config

### Diff (WriteFile + PatchFile)

🟢 CONFIRMADO — Algoritmo LCS (Longest Common Subsequence) com DP. Guard para arquivos >5000 linhas (retorna summary ao invés de diff completo).

---

## Módulo: commands

**Caminho:** `src/commands/`
**Propósito:** 22 slash commands disponíveis na CLI interativa.

### Arquitetura

🟢 CONFIRMADO — Cada command é um módulo em `src/commands/{name}/index.ts` que exporta um objeto `Command`:
```ts
interface Command {
  name: string
  aliases: string[]
  parse(args: string[]): CommandResult
}
```

### Catálogo

| Comando | Aliases | Função |
|---------|---------|--------|
| /help | - | Lista todos os comandos |
| /model | /m | Troca modelo ativo |
| /models | - | Lista modelos disponíveis |
| /clear | /c | Limpa histórico |
| /compact | - | Compacta contexto manualmente |
| /plan | /p | Modo planejamento |
| /review | /r | Revisão de código |
| /theme | /t | Muda tema visual |
| /agent | /a | Carrega agente custom |
| /agents | - | Lista agentes disponíveis |
| /vim | - | Toggle vim mode |
| /quit | /q, /exit | Sai da aplicação |
| /checkpoint | /cp | Salva/lista/restaura checkpoints |
| /sessions | - | Lista sessões anteriores |
| /language | /lang | Define idioma preferido |
| /undo | /u | Desfaz última escrita de arquivo |
| /retry | - | Reenvia última mensagem |
| /cost | - | Mostra estimativa de custo |
| /files | - | Lista arquivos modificados |
| /tools | - | Lista tools disponíveis |
| /system | - | Mostra system prompt |
| /permissions | /perms | Mostra permissões ativas |
| /msg | - | Adiciona nota background |
| /stats | - | Estatísticas da sessão |

---

## Módulo: ink

**Caminho:** `src/ink/`
**Propósito:** Fork customizado do Ink — React TUI renderer para terminal.

### Componentes principais

🟢 CONFIRMADO — Box, Text, Button, ScrollBox, Link, Newline, Spacer, RawAnsi, AlternateScreen, NoSelect, ErrorOverview.

### Layout Engine

🟢 CONFIRMADO — Baseado em Yoga (via bindings TS puros em `src/native-ts/yoga-layout/`). Flexbox para terminal.

### Event System

🟢 CONFIRMADO — Click, Focus, Keyboard, Paste, Resize, TerminalFocus. Dispatcher central com hit-testing para click events.

### Terminal I/O (`termio/`)

🟢 CONFIRMADO — Parser e tokenizer de sequências ANSI/SGR/CSI/OSC/DEC/ESC. Suporte completo a:
- ANSI color codes (16, 256, truecolor)
- Cursor control
- Mouse tracking
- Bidirectional text (bidi-js)
- East Asian width detection

### Rendering Pipeline

🟢 CONFIRMADO:
1. `reconciler.ts` — React reconciler customizado (via `react-reconciler`)
2. `renderer.ts` — Converte tree → output
3. `render-node-to-output.ts` — Node individual → strings ANSI
4. `render-border.ts` — Bordas com cli-boxes
5. `render-to-screen.ts` — Output final → stdout
6. `log-update.ts` — Overwrite otimizado (só re-renderiza linhas alteradas)

---

## Módulo: ui

**Caminho:** `src/ui/`
**Propósito:** Componentes de aplicação — input, messages, layout, setup.

### App.tsx (Componente raiz)

🟢 CONFIRMADO — Orquestra estado da aplicação:
- Messages (user, assistant, tool, terminal, thinking)
- Tool status (name, args, done, result)
- Confirm dialogs (destructive operations)
- Tool permission prompts
- Mode switching (plan/build/auto via Shift+Tab)
- Session persistence (auto-save)
- Command processing (/model, /clear, etc.)

### Input System (`input/`)

🟢 CONFIRMADO:
- **InputBox** — Editor multiline com cursor
- **Cursor** — Posição, seleção, kill ring (clipboard circular)
- **Ghost hints** — Command autocomplete, history ghost, argument hints
- **Vim mode** — Normal/Insert/Visual modes com motions e operators
- **Paste handler** — Detecção automática de paste (flood de chars)

### Interaction Modes

🟢 CONFIRMADO:
- **Plan** — Read-only tools apenas. Modelo pode ativar.
- **Build** (default) — Todas as tools. Pede confirmação para operações destrutivas e config writes.
- **Auto** — Zero restrições. Só ativável pelo usuário (Shift+Tab).

Ciclo: `plan → build → auto → plan`

---

## Módulo: hooks

**Caminho:** `src/hooks/`
**Propósito:** Sistema extensível de hooks para interceptar tool use e session start.

### Eventos

🟢 CONFIRMADO:
- `PreToolUse` — Antes da execução. Pode bloquear ou modificar input.
- `PostToolUse` — Após execução (fire-and-forget).
- `SessionStart` — Ao iniciar a sessão.

### Mecanismo

🟢 CONFIRMADO — Hooks são shell commands executados via `child_process.spawn`. Recebem JSON no stdin, retornam JSON no stdout. Timeout configurável (default 30s).

### Segurança

🟢 CONFIRMADO — Hooks só são carregados de user-level settings (`~/.deepseek/settings.json`). Project-level hooks são explicitamente stripados em `settings/loader.ts` para prevenir repositórios maliciosos.

---

## Módulo: permissions

**Caminho:** `src/permissions/`
**Propósito:** Sistema de allow/deny rules com glob matching.

### Resolução

🟢 CONFIRMADO — Ordem: deny first → allow → fallback.
- Se só deny rules e nada match → allow
- Se allow rules existem mas nada match → ask

### Glob Matching

🟢 CONFIRMADO — Iterativo (imune a ReDoS). Limite de 10 wildcards por pattern. Case-insensitive.

### Content Matching

🟢 CONFIRMADO — Por tool:
- `shell` → match no `command`
- `read_file/write_file/patch_file` → match no `path`
- `web_fetch` → match no `url`
- `grep` → match no `pattern`

---

## Módulo: settings

**Caminho:** `src/settings/`
**Propósito:** Carregamento hierárquico de configurações.

### Níveis (precedência crescente)

🟢 CONFIRMADO:
1. `~/.deepseek/settings.json` (user)
2. `.deepseek/settings.json` (project)
3. `.deepseek/settings.local.json` (local)

### Merge Strategy

🟢 CONFIRMADO:
- Arrays: concat + dedup
- Objects: deep merge (1 nível)
- Scalars: higher priority wins

### Segurança

🟢 CONFIRMADO — `hooks` são stripados dos níveis project e local antes do merge. Só user-level hooks são aceitos.

---

## Módulo: services

**Caminho:** `src/services/`
**Propósito:** Serviços auxiliares (compact, MCP, session).

### Auto-Compact (`compact/autoCompact.ts`)

🟢 CONFIRMADO:
- **Trigger:** `contextUsage/contextLimit > threshold` (default 0.85)
- **Circuit breaker:** desativa após 3 falhas consecutivas
- **MicroCompact:** trunca tool results antigos (mantém últimos 5)

### MCP (`mcp/`)

🟢 CONFIRMADO — Re-export de `agent/mcp.ts`. Suporta transports: stdio e HTTP Streamable. Sanitiza env vars (bloqueia `PATH`, `LD_PRELOAD`, etc.). Valida commands contra injection patterns.

---

## Módulo: state

**Caminho:** `src/state/`
**Propósito:** State management centralizado.

### Store (`store.ts`)

🟢 CONFIRMADO — Pub/sub simples: `getState()`, `setState(partial)`, `subscribe(listener)`, `resetState()`.

**AppState:**
- sessionId, provider, model
- tokenCount, contextUsage, contextLimit
- activeAgent, isProcessing

---

## Módulo: utils

**Caminho:** `src/utils/`
**Propósito:** Utilitários compartilhados.

### Principais

| Arquivo | Função |
|---------|--------|
| `credentials.ts` | Migração de config, logout (limpa `~/.deepseek/`) |
| `fs.ts` | `readJson`, `writeJson`, `writeRaw`, `globFiles` |
| `env.ts` | Helpers para variáveis de ambiente |
| `debug.ts` | Debug logging condicional |
| `semver.ts` | Comparação de versões semânticas |
| `auto-update.ts` | Check npm registry para updates |
| `chatError.ts` | Formatação de erros da API para o usuário |
| `sliceAnsi.ts` | Slice de strings com códigos ANSI |
| `intl.ts` | Internacionalização |
| `fullscreen.ts` | Terminal fullscreen mode |
| `earlyInput.ts` | Captura input antes do React montar |
| `ink-shims.ts` | Compatibilidade Ink |

---

## Módulo: constants

**Caminho:** `src/constants/`
**Propósito:** Constantes globais organizadas por domínio.

### Valores chave

🟢 CONFIRMADO:

| Constante | Valor | Arquivo |
|-----------|-------|---------|
| `PRODUCT_NAME` | "DeepSeek Code" | `product.ts` |
| `PRODUCT_CLI_NAME` | "deepseek" | `product.ts` |
| `CONFIG_DIR` | ".deepseek" | `product.ts` |
| `UNDO_STACK_MAX` | 10 | `agent.ts` |
| `CONTEXT_COMPACT_THRESHOLD` | 0.85 | `agent.ts` |
| `MICRO_COMPACT_KEEP_LAST` | 5 | `agent.ts` |
| `CHECKPOINT_MAX` | 20 | `agent.ts` |
| `SHELL_OUTPUT_MAX_CHARS` | 50,000 | `tools.ts` |
| `SHELL_TIMEOUT_MS` | 30,000 | `tools.ts` |
| `GREP_MAX_LINES` | 200 | `tools.ts` |
| `GLOB_MAX_FILES` | 500 | `tools.ts` |
| `SUBAGENT_MAX_ITERATIONS` | 15 | `tools.ts` |
| `DIFF_MAX_LINES` | 50 | `ui.ts` |
