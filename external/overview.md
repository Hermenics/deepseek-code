# DeepSeek Code

DeepSeek Code é uma ferramenta de programação com IA que roda diretamente no terminal. Funciona de forma análoga ao Claude Code e ao Hermes Agent, mas usando modelos DeepSeek (ou qualquer provider compatível).

## O que é

É um assistente de código **agentic** com TUI (Text User Interface) — ele não apenas responde perguntas, mas age: lê e escreve arquivos, executa comandos shell, faz buscas no código, gerencia git, e muito mais. Tudo via linguagem natural, sem sair do terminal.

## Como funciona

Você instala globalmente, roda `deepseek` dentro de qualquer projeto, e conversa com o assistente que já entende o contexto do seu codebase.

```bash
npm install -g @aethelics/deepseek-code
deepseek
```

Na primeira execução, você escolhe um **provider** e configura a autenticação. As configurações ficam salvas em `~/.deepseek/config.json`.

## Providers suportados

| Provider | Autenticação | Variáveis de ambiente |
|---|---|---|
| **DeepSeek API** (padrão) | API key | `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL` |
| **Amazon Bedrock** | IAM via `~/.aws/credentials` | `AWS_REGION`, `AWS_PROFILE` |
| **Google Vertex AI** | Service account JSON | `GCP_PROJECT`, `GCP_LOCATION`, `GCP_CREDENTIALS` |
| **Local (Ollama / LM Studio)** | Nenhuma | `LOCAL_BASE_URL`, `LOCAL_MODEL` |
| **OAuth (beta)** | Login via browser | Auto-configurado |

## Modelos disponíveis

Troque de modelo a qualquer momento com `/model` dentro do TUI:

| Modelo | Descrição | Contexto |
|---|---|---|
| `deepseek-v4-flash` | Rápido, uso geral (padrão) | 128K |
| `deepseek-v4-pro` | Raciocínio avançado | 128K |

Cada provider também expõe seus próprios modelos específicos.

## Arquitetura resumida

O projeto é construído em camadas:

```
CLI Entry (cli.tsx)
    ↓
UI Layer — React/Ink (InputBox, MessageList, StatusBar, ToolUseDisplay)
    ↓
Agent Layer — loop de agente, ferramentas, permissões, compactação de contexto
    ↓
Provider Layer — DeepSeek API, Bedrock, Vertex, Local, Proxy
    ↓
Infrastructure — Settings, Hooks, Session, MCP
```

**Stack técnica:** Bun + React 19 + TypeScript + OpenAI SDK (como abstração de provider) + Ink (fork customizado para TUI).

Princípios que guiam o design:
- **Single-process** — tudo roda em um único processo Bun
- **Stateless LLM** — cada request envia o contexto completo (sem memória server-side)
- **File-based persistence** — configurações e estado em JSON em `~/.deepseek/`
- **Security by default** — sandbox de filesystem, proteção contra SSRF, sistema de permissões
- **Provider-agnostic** — OpenAI SDK como camada de abstração; providers são plugáveis

## TUI

- Roda na **alternate screen** do terminal — viewport limpo, scroll sem truncamento
- Saída de thinking é streamada em blocos multiline e persiste após cada resposta
- Para forçar modo main-screen (experimental): `OTUI_USE_ALTERNATE_SCREEN=0 deepseek`

## Comandos úteis

| Comando | O que faz |
|---|---|
| `/model` | Troca o modelo em uso |
| `/help` | Abre ajuda e link para reportar bugs |

## Reportar bugs

Abra uma [issue no GitHub](https://github.com/Aethelics/deepseek-code/issues) ou use `/help` dentro do TUI.
