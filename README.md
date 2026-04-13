<div align="center">
  
# DeepSeek Code

<p>
  <img src="https://img.shields.io/badge/version-0.1.0-cyan?style=for-the-badge" alt="version" />
  <img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?style=for-the-badge&logo=bun&logoColor=black" alt="Bun" />
  <img src="https://img.shields.io/badge/model-DeepSeek-4A90D9?style=for-the-badge" alt="DeepSeek" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="MIT License" />
</p>

**An AI-powered coding assistant for the terminal, built with Bun, Ink and the DeepSeek API.**

</div>

---

## ✨ Highlights

- 🐋 **Terminal UI** — Beautiful TUI built with Ink (React for CLI)
- 🤖 **Streaming agent loop** — Real-time responses with tool call support
- 🛠️ **8 built-in tools** — File read/write, shell, grep, glob, web fetch and more
- 🧑‍💼 **Custom agents** — Create personas with system prompt, model and injected files
- 📋 **Steering files** — Automatically inject global context into every session
- 🎨 **Themes** — Dark, light, daltonized and ANSI
- 😂 **Spinner with puns** — Because waiting can be fun

---

## 🚀 Quick Start

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.0
- A [DeepSeek](https://platform.deepseek.com/api_keys) API key

### Installation

```bash
npm install -g deepseek-code
```

Or run from source:

```bash
# Clone the repository
git clone https://github.com/your-username/deepseek-code.git
cd deepseek-code

# Install dependencies
bun install

# Start
bun run start
```

On first run, DeepSeek Code will ask for your API key and preferred theme. Everything is saved to `~/.deepseek-code/config.json`.

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
| `/clear` | Clear conversation history |
| `/help` | Show available commands |
| `/quit` or `/q` | Exit the program |

> Tip: start typing `/` to see the autocomplete dropdown — use ↑↓ to navigate.

---

## 🛠️ Available Tools

DeepSeek Code has access to these tools during the conversation:

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents (with line range support) |
| `write_file` | Write/create a file |
| `read_folder` | List directory (with recursive option) |
| `grep` | Search regex pattern in files |
| `glob` | Find files by glob pattern |
| `shell` | Execute shell commands |
| `introspect` | System info (OS, cwd, git status, etc.) |
| `web_fetch` | Fetch content from a URL |

---

## 🧑‍💼 Custom Agents

Create agents with their own personality, model and context.

### File structure

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
# Via command
/agent rust-expert

# Via CLI
bun run start agent rust-expert
```

---

## 📋 Steering Files

Automatically inject global context into every session — no agent configuration needed.

Create `.md` files in `.deepseek/steering/`:

```bash
mkdir -p .deepseek/steering

cat > .deepseek/steering/conventions.md << 'EOF'
# Project Conventions
- Always use strict TypeScript
- Prefer pure functions
- Use Bun-native APIs over Node equivalents
EOF
```

The content is automatically injected into the system prompt on startup.

---

## 🎨 Themes

Choose your theme on first run. To change it later, delete `~/.deepseek-code/config.json` and restart.

| Theme | Description |
|-------|-------------|
| `dark` | Dark mode (default) |
| `light` | Light mode |
| `dark-daltonized` | Dark, colorblind-friendly |
| `light-daltonized` | Light, colorblind-friendly |
| `dark-ansi` | Dark with pure ANSI colors |
| `light-ansi` | Light with pure ANSI colors |

---

## 📂 Project Structure

```
deepseek-code/
├── src/
│   ├── index.tsx          # Entrypoint — arg parsing and render
│   ├── agent.ts           # Agent loop with streaming and tool calls
│   ├── agentConfig.ts     # Custom agent loader
│   ├── agentFiles.ts      # File resolution via glob
│   ├── steering.ts        # Steering file loader
│   ├── commands.ts        # Slash command parser
│   ├── tools/             # Tools available to the agent
│   │   ├── ReadFile.ts
│   │   ├── WriteFile.ts
│   │   ├── ReadFolder.ts
│   │   ├── Grep.ts
│   │   ├── Glob.ts
│   │   ├── Shell.ts
│   │   ├── Introspect.ts
│   │   ├── WebFetch.ts
│   │   └── index.ts
│   └── ui/                # Ink components (React for CLI)
│       ├── App.tsx         # Main component
│       ├── InputBox.tsx    # Input with autocomplete and spinner
│       ├── MessageList.tsx # Message list
│       ├── StatusBar.tsx   # Status bar
│       ├── ToolUseDisplay.tsx
│       ├── Mascot.tsx      # 🐋
│       ├── WelcomeScreen.tsx
│       └── ApiKeySetup.tsx
├── .deepseek/
│   ├── agents/            # Local project agents
│   └── steering/          # Local steering files
└── package.json
```

---

## 🔐 Configuration

The API key is saved to `~/.deepseek-code/config.json` after the initial setup:

```json
{
  "DEEPSEEK_API_KEY": "sk-...",
  "THEME": "dark"
}
```

You can also set it via environment variable:

```bash
DEEPSEEK_API_KEY=sk-... bun run start
```

---

## 🎯 Models

| Model | Alias | Recommended for |
|-------|-------|-----------------|
| `deepseek-chat` | DeepSeek-V3 | General use, fast and cheap |
| `deepseek-reasoner` | DeepSeek-R1 | Complex problems, chain-of-thought reasoning |

---

## 🧪 Development

```bash
# Run in dev mode
bun run start

# Type check
bun run tsc --noEmit
```

---

## 📄 License

MIT — see the [LICENSE](LICENSE) file for details.

---

<div align="center">
  <sub>Made with ❤️ and lots of <code>bun run start</code></sub>
</div>
