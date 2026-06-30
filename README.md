<div align="center">

<img src="https://raw.githubusercontent.com/Hermenics/deepseek-code/main/src/public/deepseek-code.png" alt="DeepSeek Code" height="250"/>

<br/>

<p>
  <a href="https://www.npmjs.com/package/@hermenics/deepseek-code"><img src="https://img.shields.io/npm/v/@hermenics/deepseek-code?style=for-the-badge&labelColor=0d1117&color=cyan" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/model-DeepSeek-4A90D9?style=for-the-badge&labelColor=0d1117" alt="DeepSeek" />
  <img src="https://img.shields.io/badge/license-Apache--2.0-22c55e?style=for-the-badge&labelColor=0d1117" alt="Apache 2.0" />
  <a href="https://github.com/Hermenics/deepseek-code/actions"><img src="https://img.shields.io/github/actions/workflow/status/Hermenics/deepseek-code/ci.yml?style=for-the-badge&labelColor=0d1117&label=CI" alt="CI" /></a>
</p>

<p><strong>An open-source, DeepSeek-powered coding assistant that lives in your terminal.</strong></p>

</div>

---

<div align="center">
  <img src="https://raw.githubusercontent.com/Hermenics/deepseek-code/main/src/public/demo.gif" alt="DeepSeek Code demo" width="80%" />
  <br/>
  <sub><i>Simulated output for demonstration purposes.</i></sub>
</div>

---

## Features

- **Agentic coding** — reads/writes files, runs shell commands, searches code, manages git
- **Multi-provider** — DeepSeek API, Amazon Bedrock, Google Vertex AI, or any local model (Ollama, LM Studio)
- **Full TUI** — alternate-screen interface with streamed thinking, rich markdown, and vim mode
- **Sub-agents** — spawn background agents for parallel tasks
- **MCP support** — connect to any Model Context Protocol server for extended tooling
- **Extensible** — slash commands, custom tools, memory, sessions, themes

## Quick start

```bash
npm install -g @hermenics/deepseek-code
```

Then run `deepseek` inside any project. On first run you'll pick a **provider** and configure authentication.

### Requirements

- Node.js 18+ or [Bun](https://bun.sh) 1.1+
- A supported LLM provider (see below)

## Providers & authentication

| Provider | How to authenticate | Env / config keys |
|----------|--------------------|--------------------|
| **DeepSeek API** (default) | API key from [platform.deepseek.com](https://platform.deepseek.com/api_keys) | `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL` |
| **Amazon Bedrock** | AWS IAM credentials via `~/.aws/credentials` | `AWS_REGION`, `AWS_PROFILE` |
| **Google Vertex AI** | GCP service account JSON key | `GCP_PROJECT`, `GCP_LOCATION`, `GCP_CREDENTIALS` |
| **Local (Ollama / LM Studio)** | No auth — point to your local endpoint | `LOCAL_BASE_URL`, `LOCAL_MODEL` |

All config is saved to `~/.deepseek/config.json`. Any config key can also be set as an environment variable.

## Models

Switch models at any time with `/model`:

| Model ID | Description | Context |
|----------|-------------|---------|
| `deepseek-v4-flash` | Fast, general purpose (default) | 128K |
| `deepseek-v4-pro` | Advanced reasoning | 128K |

Each provider also exposes provider-specific models (Bedrock, Vertex, local).

## Slash commands

| Command | Description |
|---------|-------------|
| `/model` | Switch model |
| `/agent` | Spawn a sub-agent |
| `/memory` | Manage persistent memory |
| `/plan` | Enter plan mode |
| `/review` | Code review |
| `/vim` | Toggle vim keybindings |
| `/theme` | Change color theme |
| `/tools` | List available tools |
| `/help` | Show all commands |

## Built-in tools

The agent has access to these tools out of the box:

`ReadFile` · `WriteFile` · `PatchFile` · `Shell` · `Glob` · `Grep` · `Git` · `ReadFolder` · `WebFetch` · `SubAgent` · `Memory` · `Todo` · `Introspect` · `MoA`

## TUI behavior

- Runs on the terminal **alternate screen** — clean viewport, smooth scrolling
- Thinking output is streamed as full multiline blocks and persisted after each response
- Main-screen mode (experimental): `OTUI_USE_ALTERNATE_SCREEN=0 deepseek`

---

## Development

### Prerequisites

- [Bun](https://bun.sh) >= 1.1
- Node.js >= 18 (for npm publishing)

### Setup

```bash
git clone https://github.com/Hermenics/deepseek-code.git
cd deepseek-code
bun install
```

### Commands

```bash
bun run dev          # Start in dev mode (watch)
bun run start        # Run from source
bun run build        # Production build
bun run typecheck    # Type check (tsc --noEmit)
bun test             # Run tests
```

### Project structure

```
src/
├── agent/           # Core agent loop, providers (DeepSeek, Bedrock, Vertex)
├── commands/        # Slash command definitions
├── components/      # Ink/React TUI components
├── tools/           # Agent tools (file ops, shell, git, search, etc.)
├── context/         # Conversation context management
├── hooks/           # Pre/post tool execution hooks
└── index.tsx        # Entry point
tests/               # Test suite
```

---

## Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repo and create a branch from `main`
2. **Install** dependencies with `bun install`
3. **Make your changes** — keep files under 500 lines
4. **Run checks** before submitting:
   ```bash
   bun run typecheck && bun test
   ```
5. **Open a PR** with a clear description of what changed and why

### Guidelines

- Follow existing code style (TypeScript, functional where possible)
- Write tests for new features — tests live in `tests/`, never in `src/`
- One concern per PR — don't bundle unrelated changes
- Commit messages should explain the "why", not just the "what"

### Reporting bugs

File a [GitHub issue](https://github.com/Hermenics/deepseek-code/issues) with steps to reproduce, or use `/help` inside the TUI.

---

## License

[Apache 2.0](./LICENSE)

---

<div align="center">
  <p>Made with ❤️ by <a href="https://github.com/Hermenics">Hermenics</a></p>
</div>
