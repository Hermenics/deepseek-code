# DeepSeek Code — Relatório Completo do Projeto

**Versão:** 0.3.9  
**Pacote:** `@hermenics/deepseek-code`  
**Licença:** Apache-2.0  
**Repositório:** https://github.com/Hermenics/deepseek-code

---

## 1. Visão Geral

DeepSeek Code é um assistente de programação com IA que vive no terminal. Funciona como um agente autônomo capaz de ler/escrever arquivos, executar comandos, buscar código, gerenciar git e orquestrar sub-agentes — tudo dentro de uma TUI (Terminal User Interface) rica construída com React.

**Diferencial:** Suporte multi-provider (DeepSeek API, Amazon Bedrock, Google Vertex AI, modelos locais via Ollama/LM Studio) com uma interface unificada OpenAI-compatible.

---

## 2. Stack Tecnológica

| Camada | Tecnologia |
|--------|-----------|
| Runtime | Bun >= 1.1 (compatível com Node.js 18+) |
| Linguagem | TypeScript (strict) |
| UI Framework | React 19 + custom Ink-compatible renderer |
| LLM Client | OpenAI SDK (adaptado para cada provider) |
| Testes | Vitest (via `bun test`) |
| Build | Bun bundler (`build.ts`) |
| CI | GitHub Actions (typecheck + tests) |
| Package Manager | Bun (bun.lock) |

---

## 3. Métricas do Código

| Métrica | Valor |
|---------|-------|
| Total de linhas (src/) | ~42.359 |
| Arquivos fonte | ~190 |
| Arquivos de teste | ~85 |
| Dependências (prod) | 30 |
| Dependências (dev) | 6 |
| Slash commands | 33 |
| Agent tools | 19 |

---

## 4. Arquitetura

### 4.1. Diagrama de Módulos

```
src/
├── index.tsx              # Entry point (delega para cli.tsx)
├── entrypoints/
│   ├── cli.tsx            # TUI interativa (React)
│   └── pipe.ts            # Modo headless (stdin/stdout)
├── agent/                 # Core do agente
│   ├── agent.ts           # Loop principal, tool dispatch, streaming
│   ├── llmClient.ts       # Factory de client OpenAI por provider
│   ├── providers/         # Bedrock, Vertex (signers, adapters)
│   ├── config.ts          # Carregamento de agentes customizados
│   ├── session.ts         # Persistência de sessões
│   ├── memory.ts          # Memória persistente do agente
│   ├── steering.ts        # System prompt + DEEPSEEK.md injection
│   ├── cost.ts            # Estimativa de custo por token
│   ├── checkpoint.ts      # Checkpoints de conversa
│   ├── fileCheckpoint.ts  # Checkpoints de filesystem
│   ├── worktree.ts        # Git worktree management
│   └── planMode.ts        # Modo planejamento
├── tools/                 # Ferramentas disponíveis ao agente
│   ├── WriteFile/         # Escrita de arquivo
│   ├── EditFile/          # Edição inline (search/replace)
│   ├── PatchFile/         # Patch unificado
│   ├── ReadFile/          # Leitura de arquivo
│   ├── ReadFolder/        # Listagem de diretório
│   ├── Shell/             # Execução de comandos
│   ├── Grep/              # Busca por padrão
│   ├── Glob/              # Busca por nome de arquivo
│   ├── Git/               # Operações git
│   ├── WebFetch/          # HTTP requests
│   ├── SubAgent/          # Orquestração de sub-agentes
│   ├── AskAgent/          # Consulta a agente sem tool call
│   ├── Memory/            # Persistência de conhecimento
│   ├── Todo/              # Lista de tarefas
│   ├── MoA/               # Mixture of Agents
│   ├── Introspect/        # Auto-reflexão do agente
│   ├── UpdateKnowledge/   # Atualização de memória
│   ├── SubmitPlan/        # Submissão de plano para review
│   └── WritePlan/         # Escrita do arquivo de plano
├── orchestration/         # Multi-agent orchestration
│   ├── OrchestratorSession.ts  # Sessão de orquestração
│   ├── TaskRegistry.ts    # Registro e lifecycle de tasks
│   ├── workspace.ts       # Isolamento de workspace por task
│   ├── mailbox.ts         # Comunicação entre agentes
│   ├── events.ts          # Event sink para telemetria
│   ├── snapshot.ts        # Persistência de estado
│   ├── review.ts          # Review automatizado
│   └── schema.ts          # Validação de argumentos
├── commands/              # 33 slash commands
│   ├── model/             # /model — trocar modelo
│   ├── agent/             # /agent — carregar agente
│   ├── config/            # /config — settings center
│   ├── plan/              # /plan — modo planejamento
│   ├── review/            # /review — code review
│   ├── worktree/          # /worktree — git worktrees
│   ├── skill/             # /skill — gerenciar skills
│   ├── plugin/            # /plugin — gerenciar plugins
│   ├── mobile/            # /mobile — QR code para app
│   ├── cwd/               # /cwd — mudar diretório
│   └── ...                # (clear, compact, memory, etc.)
├── ui/                    # Componentes React da TUI
│   ├── App.tsx            # Componente principal (1348 linhas)
│   ├── input/             # InputBox, CommandDropdown, key handling
│   ├── messages/          # MessageList, DiffView, Markdown, TodoPanel
│   ├── layout/            # StatusBar, WelcomeScreen
│   ├── setup/             # ConfigMenu, ApiKeySetup, ModelSelector
│   ├── subagent/          # SubagentList, SubagentLine (tree view)
│   └── plan/              # PlanApprovalPrompt
├── ink/                   # Renderer de terminal (fork customizado de Ink)
│   ├── ink.tsx            # Core renderer (1754 linhas)
│   ├── components/        # Box, Text, AlternateScreen, ScrollBox, Link
│   ├── hooks/             # use-input, use-stdin, use-interval, etc.
│   ├── layout/            # Yoga-based layout engine
│   ├── events/            # Input/keyboard/paste/resize events
│   └── termio/            # ANSI/CSI/SGR parser e tokenizer
├── services/
│   └── compact/           # Auto-compaction de contexto
├── settings/              # Sistema de configuração em 3 níveis
│   ├── loader.ts          # Merge User < Project < Local
│   ├── repository.ts      # CRUD de settings
│   ├── types.ts           # DeepSeekSettings interface
│   └── writer.ts          # Serialização
├── permissions/           # Sistema de permissões
│   ├── risk.ts            # Avaliação de risco por tool/comando
│   ├── matcher.ts         # Pattern matching (glob)
│   └── explain.ts         # Explicação human-readable
├── hooks/                 # Pre/Post tool hooks
│   ├── executor.ts        # Execução de hook commands
│   ├── matcher.ts         # Matching de hooks por tool
│   └── types.ts           # HookEvent, HookCommand, etc.
├── plugins/               # Sistema de plugins (git-based)
│   ├── installer.ts       # Clone, update, remove
│   ├── loader.ts          # Carregamento de componentes
│   └── registry.ts        # Registro persistente
├── skills/                # Sistema de skills
│   ├── installer.ts       # Instalação de skills
│   ├── registry.ts        # Registro de skills
│   └── validate.ts        # Validação de SKILL.md
├── constants/             # Constantes globais
├── types/                 # Tipos compartilhados
└── utils/                 # Utilitários (credentials, fs, env, etc.)
```

### 4.2. Fluxo de Dados Principal

```
User Input
    │
    ▼
┌─────────────────┐
│   InputBox      │  Captura texto, histórico, vim mode, ghost text
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Command Parse  │  Se começa com /, despacha para o command handler
└────────┬────────┘
         │ (se não é comando)
         ▼
┌─────────────────┐
│   Agent Loop    │  Monta messages[], chama LLM, processa tool_calls
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌──────────┐
│  Text  │ │ Tool Use │  Executa ferramentas (com hooks pre/post)
└────────┘ └─────┬────┘
                  │
                  ▼
         ┌────────────────┐
         │ Tool Result    │  Resultado volta como mensagem ao LLM
         └────────────────┘
                  │
                  ▼  (loop até o agente responder sem tool_calls)
         ┌────────────────┐
         │ Final Response │  Renderizado como Markdown na TUI
         └────────────────┘
```

---

## 5. Providers e Modelos

### 5.1. Factory Pattern

O `llmClient.ts` cria instâncias do OpenAI SDK configuradas por provider:

| Provider | Base URL | Auth |
|----------|----------|------|
| `deepseek` | `api.deepseek.com` | API key |
| `bedrock` | `bedrock-mantle.{region}.api.aws` (V3.x) ou `bedrock-runtime.{region}.amazonaws.com` (R1) | AWS SigV4 |
| `vertex` | `{location}-aiplatform.googleapis.com` | GCP service account |
| `local` | Configurável (default `localhost:11434`) | Nenhuma |

### 5.2. Modelos Default

| Provider | Modelo padrão |
|----------|--------------|
| DeepSeek | `deepseek-v4-flash` |
| Bedrock | `us.deepseek.r1-v1:0` |
| Vertex | `deepseek-ai/deepseek-r1` |
| Local | `llama3` |

### 5.3. Bedrock Emulation

DeepSeek R1 no Bedrock não suporta tool calling nativo. O sistema injeta definições de tools no system prompt em formato XML e parseia `<tool_call>` blocks da resposta.

---

## 6. Sistema de Tools

Cada tool implementa a interface:

```typescript
interface Tool {
  name: string
  description: string
  parameters: object  // JSON Schema
  execute(args: Record<string, unknown>, context?: ToolExecutionContext): Promise<string>
}
```

### 6.1. Tools Disponíveis (19)

| Tool | Função |
|------|--------|
| `WriteFile` | Cria/sobrescreve arquivos |
| `EditFile` | Edição inline (search & replace) |
| `PatchFile` | Aplica patches unificados |
| `ReadFile` | Lê conteúdo de arquivo |
| `ReadFolder` | Lista diretório |
| `Shell` | Executa comandos no terminal |
| `Grep` | Busca por regex em arquivos |
| `Glob` | Busca por pattern de nomes |
| `Git` | Operações git (status, diff, commit, etc.) |
| `WebFetch` | HTTP GET/POST requests |
| `SubAgent` | Spawn de sub-agentes com tasks isoladas |
| `AskAgent` | Consulta a agente sem execução de tools |
| `Memory` | CRUD de memória persistente |
| `Todo` | Gerenciamento de tarefas |
| `Introspect` | Auto-reflexão e debug |
| `UpdateKnowledge` | Atualização de base de conhecimento |
| `MoA` | Mixture of Agents (consensus) |
| `SubmitPlan` | Submit de plano para aprovação |
| `WritePlan` | Escrita de arquivo de plano |

### 6.2. Parallel Execution

Tools read-only são executadas em paralelo: `subagent`, `ask_agent`, `grep`, `glob`, `read_file`, `read_folder`, `web_fetch`, `introspect`.

---

## 7. Sistema de Comandos (33 Slash Commands)

| Comando | Aliases | Descrição |
|---------|---------|-----------|
| `/help` | — | Mostra todos os comandos |
| `/model` | — | Troca modelo |
| `/clear` | — | Limpa histórico |
| `/compact` | — | Compacta contexto |
| `/plan` | — | Modo planejamento |
| `/review` | — | Code review |
| `/config` | `/settings` | Settings center fullscreen |
| `/agent` | — | Carrega agente customizado |
| `/agents` | — | Lista agentes disponíveis |
| `/vim` | — | Toggle vim mode |
| `/quit` | `/q`, `/exit` | Sair |
| `/checkpoint` | — | Save/list/restore checkpoints |
| `/sessions` | — | Gerencia sessões |
| `/undo` | — | Desfaz última operação |
| `/retry` | — | Re-executa última mensagem |
| `/cost` | — | Mostra custo acumulado |
| `/files` | — | Lista arquivos tocados |
| `/tools` | — | Lista tools disponíveis |
| `/system` | — | Mostra system prompt |
| `/permissions` | — | Explica modo e permissões |
| `/msg` | — | Envia nota ao agente |
| `/stats` | — | Estatísticas da sessão |
| `/memory` | — | Gerencia memória persistente |
| `/effort` | — | Nível de esforço (low/high/max) |
| `/skill` | — | Instala/remove/lista skills |
| `/plugin` | — | Instala/remove/lista plugins |
| `/context` | — | Mostra breakdown do contexto |
| `/tasks` | — | Lista tasks do orchestrator |
| `/task` | — | Gerencia task específica |
| `/cwd` | `/cd` | Muda diretório de trabalho |
| `/worktree` | — | Gerencia git worktrees |
| `/mobile` | `/ios`, `/android` | QR code para app mobile |
| `/logout` | — | Remove credenciais salvas |

---

## 8. Sistema de Orquestração (Multi-Agent)

A pasta `src/orchestration/` implementa um sistema completo de multi-agent:

- **OrchestratorSession** — Sessão principal que gerencia tasks, workspace e memória compartilhada
- **TaskRegistry** — Registro e lifecycle (pending → running → done/failed) com limites configuráveis
- **Workspace isolation** — Cada task pode ter seu próprio workspace (file lease system)
- **Mailbox** — Comunicação assíncrona entre agentes
- **Event sink** — Telemetria com log em JSONL
- **Snapshot** — Persistência de estado para resume
- **Review** — Review automatizado de outputs

### 8.1. Limites Configuráveis

```typescript
interface AgentsSettings {
  concurrency?: number        // tasks em paralelo
  maxTasks?: number           // máximo de tasks
  maxDepth?: number           // profundidade de sub-agents
  maxFanOut?: number          // fan-out por agent
  maxRetries?: number         // retries por task
  timeoutMs?: number          // timeout por task
  maxTokens?: number          // limite de tokens
  maxCostUsd?: number         // limite de custo
}
```

---

## 9. Sistema de Permissões e Risco

### 9.1. Permissões (3 comportamentos)

- **allow** — Executa sem perguntar
- **deny** — Bloqueia silenciosamente
- **ask** — Pede confirmação ao usuário

Rules suportam patterns glob: `Shell(git *)`, `WriteFile(src/**)`, etc.

### 9.2. Avaliação de Risco

Cada tool call é avaliada em tempo real:

| Nível | Comportamento |
|-------|--------------|
| `high` | Sempre pede confirmação |
| `medium` | Pede apenas em sub-agents |
| (sem match) | Low implícito, executa direto |

Condições especiais: `large_overwrite`, `outside_project`, `config_file`, `multi_edit_burst`.

---

## 10. Sistema de Hooks

Hooks permitem executar comandos shell em resposta a eventos:

| Evento | Quando dispara |
|--------|---------------|
| `PreToolUse` | Antes de executar uma tool |
| `PostToolUse` | Após executar uma tool |
| `SessionStart` | Ao iniciar a sessão |

Um `PreToolUse` hook pode `approve`, `block` ou modificar os argumentos da tool.

---

## 11. Sistema de Settings

Configuração em 3 níveis com merge hierárquico:

```
User (~/.deepseek/settings.json)
  ▼ overridden by
Project (.deepseek/settings.json)
  ▼ overridden by
Local (.deepseek/settings.local.json)
```

### 11.1. Categorias de Settings

| Categoria | O que configura |
|-----------|----------------|
| `provider` | Nome, endpoint, região, timeout |
| `model` | Modelo padrão e de sub-agent |
| `interaction` | Modo padrão (build/plan/review/auto) |
| `compaction` | Auto-compact e threshold |
| `promptRefiner` | Refinamento de prompts |
| `permissions` | Allow/deny/suppress rules |
| `risk` | Regras de risco customizadas |
| `agents` | Concurrency, limites, modelo de sub-agent |
| `memory` | Habilitado, escopo |
| `sessions` | Retenção, auto-resume |
| `git` | Checkpoint, worktree, branch pattern |
| `interface` | Theme, vim, density, statusBar |
| `hooks` | Pre/Post tool hooks |

---

## 12. Sistema de Plugins

Plugins são repos git que podem fornecer:
- **Commands** — Novos slash commands
- **Agents** — Definições de agentes customizados
- **Skills** — Arquivos SKILL.md com instruções especializadas
- **Hooks** — Configurações de hooks

Gerenciados via `/plugin install|list|remove|update`.

---

## 13. Sistema de Skills

Skills são instruções especializadas (SKILL.md) instaláveis de repos git. Permitem ao agente aprender novos comportamentos sem modificar código.

Gerenciadas via `/skill install|list|remove|update`.

---

## 14. Interface de Usuário (TUI)

### 14.1. Renderer Customizado

O projeto inclui um fork completo do Ink (renderer React para terminal) em `src/ink/`:
- Layout engine baseada em Yoga (flexbox)
- Parser de ANSI/CSI/SGR
- Sistema de eventos (keyboard, mouse, paste, resize, focus)
- Componentes: Box, Text, AlternateScreen, ScrollBox, Link, RawAnsi
- Hooks: use-input, use-stdin, use-interval, use-terminal-viewport

### 14.2. Componentes Principais

| Componente | Responsabilidade |
|-----------|-----------------|
| `App.tsx` | Estado global, agent loop, command dispatch |
| `InputBox` | Captura de input com ghost text, vim mode |
| `MessageList` | Renderização de mensagens com markdown |
| `DiffView` | Visualização de diffs inline |
| `ToolUseDisplay` | Exibição de tool calls em execução |
| `SubagentList` | Tree view de sub-agents ativos |
| `StatusBar` | Barra de status (modo, modelo, tokens, branch) |
| `ConfigMenu` | Settings center fullscreen responsivo |
| `TodoPanel` | Painel de tarefas do agente |
| `PlanApprovalPrompt` | Confirmação de planos |

### 14.3. Modos de Interação

| Modo | Descrição |
|------|-----------|
| Build | Padrão — agente tem acesso total às tools |
| Plan | Agente só pode escrever no arquivo de plano |
| Review | Read-only — sem escrita |
| Auto | Aprova automaticamente todas as tools |

---

## 15. Temas

6 temas disponíveis:

- `dark` / `light` — Padrão
- `dark-daltonized` / `light-daltonized` — Acessibilidade para daltonismo
- `dark-ansi` / `light-ansi` — Apenas cores ANSI (compatibilidade máxima)

---

## 16. Sessões e Persistência

- **Sessões** são salvas em `~/.deepseek/sessions/` e podem ser resumidas com `--resume <id>`
- **Checkpoints** salvam estado de conversa + filesystem para rollback
- **Memória** persiste conhecimento entre sessões (escopo user ou project)
- **Input history** mantém histórico de comandos

---

## 17. Build e Distribuição

### 17.1. Build Process

```typescript
// build.ts
Bun.build({
  entrypoints: ['src/index.tsx'],
  outdir: 'dist',
  naming: 'cli.mjs',
  target: 'bun',
  minify: true,
})
```

Produz:
- `dist/cli.mjs` — Bundle minificado
- `dist/deepseek` — Shell wrapper que invoca `bun cli.mjs`

### 17.2. Publicação

```bash
npm install -g @hermenics/deepseek-code
```

O binário `deepseek` é disponibilizado globalmente.

---

## 18. CI/CD

GitHub Actions (`ci.yml`):
1. Setup Bun 1.3.13
2. `bun install`
3. `bunx tsc --noEmit` (type check)
4. `bun test` (Vitest)

Triggers: push e PR para `main`.

---

## 19. Testes

**Framework:** Vitest (executado via `bun test`)  
**Total de arquivos:** ~85 test files

### 19.1. Cobertura por Módulo

| Módulo | Arquivos de teste |
|--------|------------------|
| Agent core | agent.test, agentConfig.test, agent-files.test, agent-authorization.test |
| Providers | bedrockProvider.test, bedrock.test, vertex.test |
| Tools | tools.test, edit-file.test, patchFile.test, writeFile.test, webFetch.test, moa.test |
| Commands | commands.test, commands-extended.test |
| UI/Input | InputBox.test, cursor/*.test, hooks/*.test |
| Orchestration | orchestration-e2e.test, orchestration-memory.test, orchestration-persistence.test, orchestration-review.test, orchestration-workspace.test |
| SubAgents | subagent-contracts.test, subagent-executor.test, subagent-permissions.test, subagent-verification.test |
| Permissions | permissions/risk.test, permissionsExplain.test |
| Settings | settingsRepository.test |
| Sessions | session.test, sessionParent.test |
| Plugins | plugins/command-parse.test, installer.test, loader.test, registry.test |
| Skills | skills/command-parse.test, registry.test, validate.test |
| Hooks | hook-library.test |
| Misc | cost.test, memory.test, streaming.test, reasoning.test, worktree.test, etc. |

---

## 20. Dependências Principais

| Pacote | Uso |
|--------|-----|
| `openai` | Client SDK para todos os providers |
| `react` + `react-reconciler` | Renderização da TUI |
| `execa` | Execução de processos |
| `fast-glob` | File globbing |
| `fuse.js` | Fuzzy search |
| `chalk` | Colorização de output |
| `ajv` | Validação JSON Schema |
| `@aws-sdk/*` | Autenticação AWS para Bedrock |
| `google-auth-library` | Autenticação GCP para Vertex |
| `@modelcontextprotocol/sdk` | Suporte MCP |
| `qrcode` | Geração de QR codes |
| `semver` | Versionamento semântico |
| `lodash-es` | Utilitários |

---

## 21. Funcionalidades Especiais

### 21.1. Auto-Compaction

Quando o contexto se aproxima do limite, o sistema automaticamente:
1. Detecta threshold (configurável)
2. Cria sumário das mensagens antigas
3. Substitui por boundary marker + resumo
4. Preserva as N mensagens mais recentes

### 21.2. Prompt Refinement

Refina prompts vagos do usuário antes de enviar ao LLM, melhorando a qualidade das respostas.

### 21.3. Mixture of Agents (MoA)

Tool que consulta múltiplos modelos/providers e sintetiza uma resposta consensual.

### 21.4. File Checkpoints

Sistema de rollback que salva o estado dos arquivos antes de modificações, permitindo `/undo` e `/checkpoint restore`.

### 21.5. Git Worktrees

Suporte a git worktrees para trabalho isolado em branches separadas sem perder o estado do workspace principal.

### 21.6. Pipe Mode

Modo headless para automação:
```bash
echo "explain this" | deepseek --pipe
cat file.ts | deepseek --pipe --json "summarize"
```

---

## 22. Configuração de Desenvolvimento

```bash
git clone https://github.com/Hermenics/deepseek-code.git
cd deepseek-code
bun install
bun run dev      # Dev mode com watch
bun run start    # Execução direta do source
bun test         # Testes
bun run typecheck  # tsc --noEmit
bun run build    # Build de produção
```

### 22.1. Estrutura de Diretórios Auxiliares

| Diretório | Propósito |
|-----------|-----------|
| `.deepseek/` | Config local do projeto (worktree-state, etc.) |
| `.claude/` | Configuração de integração com Claude Code |
| `.agents/` | Definições de agentes customizados |
| `.codex/` | Integração com Codex |
| `.kiro/` | Integração com Kiro |
| `.github/` | CI workflows |
| `.vscode/` | Config do editor |
| `external/` | Dependências externas |
| `packages/` | Sub-packages (monorepo) |
| `examples/` | Exemplos de uso |
| `.reversa/` | Output do framework Reversa |

---

## 23. Roadmap Implícito (baseado na estrutura)

- Sistema de plugins e skills em maturação
- Suporte a múltiplos providers em expansão
- Orquestração multi-agent com isolamento de workspace
- Integração com MCP para extensibilidade
- Modos de interação (Build/Plan/Review/Auto) consolidados
- Settings center responsivo (narrow/medium/wide)

---

## 24. Pontos de Atenção

1. **`App.tsx` tem 1348 linhas** — candidato a decomposição
2. **`ink.tsx` tem 1754 linhas** — renderer complexo, mas autocontido
3. **Bedrock R1** requer emulação de tool calling via prompt engineering
4. O renderer Ink é um fork customizado completo — qualquer atualização do Ink upstream requer merge manual
5. O sistema de permissões tem 3 camadas (rules + risk + hooks) que interagem de forma complexa

---

*Gerado em: Julho 2026*  
*Baseado na versão 0.3.9 do código fonte*
