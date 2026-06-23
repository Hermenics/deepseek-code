# Domínio — deepseek-code

> Gerado pelo Detetive (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Glossário de Domínio

| Termo | Definição | Fonte |
|-------|-----------|-------|
| Agent | Loop de conversação LLM com tool calling, steering e context management | 🟢 `src/agent/agent.ts` |
| Tool | Capacidade executável do agente (filesystem, shell, git, web) com interface padronizada | 🟢 `src/tools/types.ts` |
| Provider | Backend LLM que o agent consome (DeepSeek, Bedrock, Vertex, Local) | 🟢 `src/types/provider.ts` |
| Proxy | Servidor HTTP local (Hono + Playwright) que faz bridge DeepSeek web → API OpenAI-compatible | 🟢 `src/agent/providers/proxy/` |
| Interaction Mode | Nível de autonomia do agente: Plan (read-only), Build (com confirmação), Auto (sem restrição) | 🟢 `src/ui/interactionMode.ts` |
| Steering | Injeção de contexto customizado no system prompt via `.deepseek/steering/*.md` e `DEEPSEEK.md` | 🟢 `src/agent/steering.ts` |
| Compact | Sumarização do histórico de conversa para liberar context window | 🟢 `src/services/compact/` |
| MicroCompact | Truncamento de tool results antigos (mantém últimos 5) | 🟢 `src/services/compact/autoCompact.ts` |
| Boundary | Marcador no histórico que delimita contexto compactado do contexto ativo | 🟢 `src/agent/compactBoundary.ts` |
| Hook | Shell command externo executado antes/depois de tool use ou no início de sessão | 🟢 `src/hooks/` |
| Permission Rule | Regra allow/deny com glob matching que controla acesso a tools | 🟢 `src/permissions/` |
| Session | Persistência completa do estado de uma conversa (messages, files, model) | 🟢 `src/agent/session.ts` |
| Checkpoint | Snapshot pontual do estado para undo/restore | 🟢 `src/agent/checkpoint.ts` |
| SubAgent | Instância independente do agente spawned para subtarefas focadas | 🟢 `src/tools/SubAgent/SubAgent.ts` |
| Custom Agent | Configuração JSON que altera system prompt, model e allowed tools | 🟢 `src/agent/config.ts` |
| Reasoning Content | Campo exclusivo de modelos DeepSeek (R1, V4-Flash) com o "pensamento" do modelo | 🟢 `src/agent/agent.ts:36` |

---

## Regras de Negócio

### Segurança

| # | Regra | Confiança | Localização |
|---|-------|-----------|-------------|
| S1 | Paths devem estar dentro do working directory (sandbox) | 🟢 | `src/tools/shared/pathSafety.ts:63` |
| S2 | Symlink traversal é bloqueado via realpath | 🟢 | `src/tools/shared/pathSafety.ts:70` |
| S3 | Arquivos sensíveis (.env, .pem, credentials, SSH keys) nunca são acessíveis pelo agente | 🟢 | `src/tools/shared/pathSafety.ts:20` |
| S4 | Diretórios internos (.deepseek, .claude, .git, node_modules) são off-limits | 🟢 | `src/tools/shared/pathSafety.ts:4` |
| S5 | WebFetch bloqueia localhost, IPs privados e metadata endpoints (SSRF prevention) | 🟢 | `src/tools/WebFetch/WebFetch.ts:12` |
| S6 | MCP env vars críticos (PATH, LD_PRELOAD, HOME, NODE_OPTIONS) nunca são sobrescritos | 🟢 | `src/agent/mcp.ts:11` |
| S7 | Shell injection patterns e path traversal bloqueados em MCP commands | 🟢 | `src/agent/mcp.ts:27-28` |
| S8 | Hooks de project-level/local-level são stripados (previne repos maliciosos) | 🟢 | `src/settings/loader.ts:98` |
| S9 | Glob matching é iterativo com limite de 10 wildcards (anti-ReDoS) | 🟢 | `src/permissions/matcher.ts:20` |
| S10 | Shell: patterns destrutivos (rm -rf, git reset --hard, mkfs, dd) requerem confirmação | 🟢 | `src/tools/Shell/Shell.ts:5` |

### Context Management

| # | Regra | Confiança | Localização |
|---|-------|-----------|-------------|
| C1 | Auto-compact dispara quando usage/limit > 85% | 🟢 | `src/agent/agent.ts:561` |
| C2 | Circuit breaker: auto-compact desativa após 3 falhas consecutivas | 🟢 | `src/services/compact/autoCompact.ts:43` |
| C3 | MicroCompact preserva os 5 últimos tool results, trunca os anteriores | 🟢 | `src/services/compact/autoCompact.ts:57` |
| C4 | History max: 500 mensagens (system + últimas N-1) | 🟢 | `src/agent/history.ts:8` |
| C5 | Sessões max: 50 no disco (prune por data) | 🟢 | `src/agent/session.ts:12` |
| C6 | Checkpoints max: 20 no disco | 🟢 | `src/agent/checkpoint.ts:7` |

### Interaction Modes

| # | Regra | Confiança | Localização |
|---|-------|-----------|-------------|
| M1 | Auto mode só pode ser ativado pelo usuário (nunca pelo modelo) | 🟢 | `src/ui/interactionMode.ts:63` |
| M2 | Auto mode bypassa TODAS as verificações de permissão | 🟢 | `src/agent/agent.ts:920` |
| M3 | Build mode pede confirmação para: shell destrutivo e config writes em .deepseek | 🟢 | `src/agent/agent.ts:934` |
| M4 | Plan mode permite apenas tools read-only | 🟢 | `src/ui/interactionMode.ts:33` |
| M5 | MCP tools seguem as mesmas regras que shell (requer permissão de shell no mode) | 🟢 | `src/ui/interactionMode.ts:40` |

### Tool Execution

| # | Regra | Confiança | Localização |
|---|-------|-----------|-------------|
| T1 | Tools parallel-safe executam concorrentemente: subagent, shell, grep, glob, read_file, read_folder, web_fetch, introspect | 🟢 | `src/agent/agent.ts:44` |
| T2 | SubAgent herda provider e permissions do parent | 🟢 | `src/tools/SubAgent/SubAgent.ts:11` |
| T3 | SubAgent max 15 iterations antes de abortar | 🟢 | `src/constants/tools.ts:13` |
| T4 | Shell output truncado a 50k chars | 🟢 | `src/constants/tools.ts:2` |
| T5 | Shell timeout default: 30s | 🟢 | `src/constants/tools.ts:5` |
| T6 | Diff (LCS) não executa para arquivos > 5000 linhas (guard OOM) | 🟢 | `src/tools/WriteFile/WriteFile.ts:9` |
| T7 | PatchFile requer old_content com exatamente 1 match (0 ou >1 = erro) | 🟢 | `src/tools/PatchFile/PatchFile.ts:61` |
| T8 | Git push usa --force-with-lease (nunca --force puro) | 🟢 | `src/tools/Git/Git.ts:115` |
| T9 | Undo stack FIFO, max 10 entries | 🟢 | `src/agent/agent.ts:1039` |

### Provider / API

| # | Regra | Confiança | Localização |
|---|-------|-----------|-------------|
| P1 | Retry com backoff exponencial (1s, 2s, 4s) em HTTP 429 e 503 | 🟢 | `src/agent/agent.ts:596` |
| P2 | Aborts nunca são retried (check signal diretamente) | 🟢 | `src/agent/agent.ts:604` |
| P3 | reasoning_content DEVE ser preservado e passado de volta à API em todas as mensagens | 🟢 | `src/agent/agent.ts:840,856,876` |
| P4 | Bedrock R1: tool calling é emulado via XML no prompt (sem suporte nativo) | 🟢 | `src/agent/agent.ts:52` |
| P5 | Bedrock V3.x: usa bedrock-mantle com Chat Completions nativo | 🟢 | `src/agent/llmClient.ts:22` |
| P6 | Streaming desabilitado para Vertex e Bedrock R1 | 🟢 | `src/agent/agent.ts:630` |

### Proxy (Bridge DeepSeek Web)

| # | Regra | Confiança | Localização |
|---|-------|-----------|-------------|
| X1 | Proxy filtra "noise" de mensagens system (system-reminder, CLAUDE.md, skills) | 🟢 | `src/agent/providers/proxy/services/message-filter.ts:23` |
| X2 | parent_message_id forçado a null em cada request (stateless, evita contexto duplicado) | 🟢 | `src/agent/providers/proxy/services/orchestrator.ts:47` |
| X3 | Tool calls no proxy usam prompt-emulation: JSON {"tool_use": ...} com regras absolutas | 🟢 | `src/agent/providers/proxy/tools/prompt-emulation.ts:11` |

---

## Decisões Técnicas Implícitas

| Decisão | Evidência | Confiança |
|---------|-----------|-----------|
| Bun como runtime principal (não Node) | Revert commit: Node target quebra Ink raw mode | 🟢 |
| Fork do Ink em vez de dependência npm | Commit `8b59345`: "migrate to custom ink renderer" | 🟢 |
| OAuth removido do codebase | Commit `e09a92b`: "remove OAuth code and consolidate provider types" | 🟢 |
| Proxy server mantido vivo entre sessões | `cli.tsx:326`: "Do NOT kill the proxy — keep it alive for the next session" | 🟢 |
| DeepSeek-V4-Flash como modelo default | `llmClient.ts:73`: `default: return 'deepseek-v4-flash'` | 🟢 |
| react-devtools stubado em produção | `bunfig.toml`: alias → `./src/stubs/react-devtools-core.ts` | 🟢 |
| Playwright como runtime de browser (não Puppeteer) | `package.json` + proxy index imports | 🟢 |
| Hono em vez de Express para o proxy | Commits de proxy: "add OAuth proxy server" com Hono desde o início | 🟡 |

---

## Lacunas Identificadas

| Área | O que falta | Tipo |
|------|-------------|------|
| Testes E2E | Nenhum teste de integração end-to-end que execute o agente completo | 🔴 LACUNA |
| Rate limiting do proxy | Configuração referenciada mas implementação não visível | 🟡 INFERIDO |
| Backup de sessões | Sem mecanismo de export/import de sessões para outro sistema | 🔴 LACUNA |
| Documentação de API do proxy | Nenhum OpenAPI/Swagger documentando as rotas | 🔴 LACUNA |
| Error recovery no streaming | Se stream corrompe mid-response, não há retry parcial | 🟡 INFERIDO |
