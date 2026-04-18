<div align="center">

<img src="https://img.shields.io/badge/%F0%9F%90%8B-DeepSeek%20Code-4A90D9?style=for-the-badge&labelColor=0d1117" alt="DeepSeek Code" height="60"/>

<br/>

<p>
  <img src="https://img.shields.io/badge/version-0.1.0-cyan?style=for-the-badge&labelColor=0d1117" alt="version" />
  <img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?style=for-the-badge&logo=bun&logoColor=black&labelColor=0d1117" alt="Bun" />
  <img src="https://img.shields.io/badge/model-DeepSeek-4A90D9?style=for-the-badge&labelColor=0d1117" alt="DeepSeek" />
  <img src="https://img.shields.io/badge/license-Apache--2.0-22c55e?style=for-the-badge&labelColor=0d1117" alt="Apache 2.0" />
  <img src="https://img.shields.io/badge/Visibility-Private-111827?style=for-the-badge&logo=github&logoColor=white" alt="Private repository" />
</p>

<p><strong>An AI-powered coding assistant that lives in your terminal.</strong></p>

<p>
  <a href="#-quick-start">Quick Start</a> ·
  <a href="#-commands">Commands</a> ·
  <a href="#-tools">Tools</a> ·
  <a href="#-custom-agents">Agents</a> ·
  <a href="#-faq">FAQ</a>
</p>

</div>

---

## ✨ Highlights

- 🐋 **Terminal UI** — Beautiful TUI built with Ink (React for CLI), themes and live streaming
- 🤖 **Agent loop** — Streaming responses with parallel tool calls and full message history
- 🛠️ **14 built-in tools** — File I/O, shell, grep, glob, git, web fetch, patch, sub-agents and more
- 🧑‍💼 **Custom agents** — Create personas with their own model, system prompt and injected files
- 📋 **Steering files** — Automatically inject project context into every session
- 🔍 **Prompt refiner** — Automatically improves your prompts before sending
- ✅ **Todo system** — Agent can create and track tasks across the session
- 💾 **Checkpoints** — Save and restore conversation state
- 🎨 **6 themes** — Dark, light, daltonized and ANSI variants
- 😂 **Spinner with puns** — Because waiting should be fun

---

## 🚀 Quick Start

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.0
- A [DeepSeek API key](https://platform.deepseek.com/api_keys)

### Installation

**Global (recommended)**
```bash
npm install -g @aethelics/deepseek-code
```

On first run, DeepSeek Code will ask for your API key, preferred language and theme. Everything is saved to `~/.deepseek-code/config.json`.

---

## ⚡ Usage

```bash
# Interactive mode
deepseek

# With an initial message
deepseek "explain what a closure is in JavaScript"

# With a custom agent
deepseek agent rust-expert

# With a custom agent and initial message
deepseek agent rust-expert "how does the borrow checker work?"
```

---

## 📖 Commands

| Command | Description |
|---------|-------------|
| `/agent <name>` | Load a custom agent |
| `/agents` | List available agents |
| `/model deepseek-chat` | Switch to DeepSeek-V3 (fast, general purpose) |
| `/model deepseek-reasoner` | Switch to DeepSeek-R1 (chain-of-thought reasoning) |
| `/models` | List available models |
| `/language <lang>` | Change response language |
| `/clear` | Clear conversation history |
| `/help` | Show available commands |
| `/quit` or `/q` | Exit |

> Tip: type `/` to open the autocomplete dropdown — use ↑↓ to navigate.

---

## 🛠️ Tools

DeepSeek Code gives the agent access to these tools during the conversation:

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents with optional line range |
| `write_file` | Write or create a file |
| `patch_file` | Apply targeted edits to a file (diff-style) |
| `read_folder` | List directory contents (recursive option) |
| `grep` | Search regex patterns across files |
| `glob` | Find files by glob pattern |
| `shell` | Execute shell commands |
| `git` | Run git operations |
| `introspect` | System info — OS, cwd, git status, env |
| `web_fetch` | Fetch and parse content from a URL |
| `todo_read` | Read the current session todo list |
| `todo_write` | Create or update todos |
| `sub_agent` | Spawn a sub-agent for isolated tasks |
| `update_knowledge` | Persist project knowledge to disk |

---

## 🧑‍💼 Custom Agents

Create agents with their own personality, model and injected context.

### Agent file format

```json
{
  "name": "rust-expert",
  "model": "deepseek-reasoner",
  "systemPrompt": "You are a Rust expert. Focus on idiomatic, safe and performant code.",
  "files": ["src/**/*.rs", "Cargo.toml"]
}
```

### Where to save

| Scope | Path |
|-------|------|
| Local (project) | `.deepseek/agents/<name>.json` |
| Global (user) | `~/.deepseek/agents/<name>.json` |

> Local agents take priority over global ones when names conflict.

### Using

```bash
# Via slash command (inside the TUI)
/agent rust-expert

# Via CLI argument
deepseek agent rust-expert
```

---

## 📋 Steering Files

Automatically inject project context into every session — no agent configuration needed.

```bash
mkdir -p .deepseek/steering

cat > .deepseek/steering/conventions.md << 'EOF'
# Project Conventions
- Always use strict TypeScript
- Prefer pure functions
- Use Bun-native APIs over Node equivalents
EOF
```

The content is injected into the system prompt on startup. Supports multiple `.md` files.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────┐
│              User (Terminal)                │
└──────────────────┬──────────────────────────┘
                   │ keystrokes
                   ▼
┌─────────────────────────────────────────────┐
│           Ink TUI (React for CLI)           │
│  App.tsx · MessageList · InputBox · Status  │
└──────────────────┬──────────────────────────┘
                   │ messages
                   ▼
┌─────────────────────────────────────────────┐
│              Agent Loop                     │
│  stream → accumulate → tool calls → loop   │
└──────┬───────────────────────┬──────────────┘
       │ API calls             │ tool execution
       ▼                       ▼
┌─────────────┐     ┌──────────────────────────┐
│ DeepSeek API│     │  Tools (14 built-in)     │
│  V3 / R1    │     │  Shell · FS · Git · Web  │
└─────────────┘     └──────────────────────────┘
```

---

## 📂 Project Structure

```
deepseek-code/
├── src/
│   ├── index.tsx              # Entrypoint — arg parsing and render
│   ├── commands.ts            # Slash command parser
│   ├── constants.ts           # Shared constants
│   ├── agent/
│   │   ├── agent.ts           # Agent loop — streaming + tool calls
│   │   ├── llmClient.ts       # DeepSeek API client
│   │   ├── config.ts          # Config loader (~/.deepseek-code)
│   │   ├── session.ts         # Session management
│   │   ├── checkpoint.ts      # Save/restore conversation state
│   │   ├── history.ts         # Message history
│   │   ├── steering.ts        # Steering file loader
│   │   ├── files.ts           # Agent file resolver (glob)
│   │   ├── promptRefiner.ts   # Automatic prompt improvement
│   │   ├── todoStore.ts       # In-session todo list
│   │   ├── cost.ts            # Token usage tracking
│   │   ├── auditLog.ts        # Tool call audit log
│   │   └── mcp.ts             # MCP server integration
│   ├── tools/                 # Tools available to the agent
│   │   ├── ReadFile.ts
│   │   ├── WriteFile.ts
│   │   ├── PatchFile.ts
│   │   ├── ReadFolder.ts
│   │   ├── Grep.ts
│   │   ├── Glob.ts
│   │   ├── Shell.ts
│   │   ├── Git.ts
│   │   ├── Introspect.ts
│   │   ├── WebFetch.ts
│   │   ├── Todo.ts
│   │   ├── SubAgent.ts
│   │   ├── UpdateKnowledge.ts
│   │   └── index.ts
│   └── ui/                    # Ink components
│       ├── App.tsx            # Root component
│       ├── messages/          # Message list and renderers
│       ├── input/             # Input box with autocomplete
│       └── setup/             # First-run setup screens
├── .deepseek/
│   ├── agents/                # Local project agents
│   └── steering/              # Local steering files
└── package.json
```

---

## 🎨 Themes

Choose your theme on first run or via the setup screen.

| Theme | Description |
|-------|-------------|
| `dark` | Dark mode (default) |
| `light` | Light mode |
| `dark-daltonized` | Dark, colorblind-friendly |
| `light-daltonized` | Light, colorblind-friendly |
| `dark-ansi` | Dark with pure ANSI colors |
| `light-ansi` | Light with pure ANSI colors |

---

## 🎯 Models

| Model | ID | Best for |
|-------|----|----------|
| DeepSeek-V3 | `deepseek-chat` | General use, fast and cost-effective |
| DeepSeek-R1 | `deepseek-reasoner` | Complex problems, chain-of-thought reasoning |

Switch at any time with `/model deepseek-reasoner` inside the TUI.

---

## 🔐 Configuration

Config is saved to `~/.deepseek-code/config.json` after the initial setup:

```json
{
  "DEEPSEEK_API_KEY": "sk-...",
  "THEME": "dark",
  "LANGUAGE": "en"
}
```

You can also set the API key via environment variable:

```bash
DEEPSEEK_API_KEY=sk-... deepseek
```

---

## 🔧 Practical Examples

<details>
<summary><strong>Ask about your codebase</strong></summary>

```bash
deepseek "what does the agent loop do in this project?"
```

The agent will use `read_file`, `glob` and `grep` to explore the code and answer.
</details>

<details>
<summary><strong>Fix a bug with context</strong></summary>

```bash
deepseek "there's a race condition in src/agent/agent.ts around tool call accumulation, fix it"
```

The agent reads the file, patches it and explains the fix.
</details>

<details>
<summary><strong>Use a reasoning model for architecture</strong></summary>

```bash
deepseek agent architect "should I use SQLite or a flat JSON file for session storage?"
```

With `deepseek-reasoner`, you get step-by-step chain-of-thought reasoning.
</details>

<details>
<summary><strong>Inject project context automatically</strong></summary>

```bash
# Create a steering file once
echo "# Stack\n- Bun runtime\n- Ink TUI\n- DeepSeek API" > .deepseek/steering/stack.md

# Every session now knows your stack
deepseek "add a new tool that reads environment variables"
```
</details>

---

## ❗ Troubleshooting

| Error | Solution |
|-------|----------|
| `DEEPSEEK_API_KEY not set` | Run `deepseek` and follow the setup prompt, or set the env var |
| `Model not found` | Use `/models` to list valid model IDs |
| `Tool execution timeout` | Shell commands have a 30s timeout — split long operations |
| `Agent not found` | Check `.deepseek/agents/` or `~/.deepseek/agents/` for the JSON file |

---

## ❓ FAQ

### Can I use it without an internet connection?

No — DeepSeek Code requires the DeepSeek API. Local model support is not available yet.

### Does it send my files to DeepSeek?

Only the content you explicitly ask about or that's included via steering files and agent `files` globs. Nothing is sent automatically.

### How do I change the language?

Use `/language pt` (or any language code) inside the TUI, or set it during the first-run setup.

### Can the agent run arbitrary shell commands?

Yes — the `shell` tool can execute any command. You'll see every command before it runs in the tool use display.

### How do I create a global agent?

Save a JSON file to `~/.deepseek/agents/<name>.json`. It'll be available in any project.

---

## 🧪 Development

```bash
# Run in dev mode
bun run start

# Type check
bun run tsc --noEmit

# Run a specific file
bun src/index.tsx
```

---

## 📄 License

Apache 2.0 — see the [LICENSE](LICENSE) file for details.

---

<div align="center">
  <p>Made with ❤️ by <a href="https://github.com/Marcelo-Henry">Marcelo</a> and DeepSeek</p>
  <sub><code>bun run start</code> and go build something.</sub>
</div>
