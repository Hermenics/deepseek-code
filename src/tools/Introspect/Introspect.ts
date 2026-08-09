import { Tool } from '../types.js'

const DOCS = `
# DeepSeek Code — Documentation

## What is DeepSeek Code?
DeepSeek Code is an open-source, terminal-based AI coding assistant built with Bun and React (Ink) for the TUI. It runs an agentic loop with streaming responses and tool calls, understanding your codebase and helping you code faster through natural language.

- **Package:** @hermenics/deepseek-code
- **Version:** 0.6.6
- **License:** Apache-2.0
- **Repository:** https://github.com/Hermenics/deepseek-code

## Providers & Authentication
DeepSeek Code supports multiple LLM providers:

| Provider | Auth method |
|----------|-------------|
| DeepSeek API (default) | API key from platform.deepseek.com |
| Amazon Bedrock | AWS IAM credentials (~/.aws/credentials) |
| Google Vertex AI | GCP service account JSON key |
| Local (Ollama / LM Studio) | No auth — point to local endpoint |
Config is saved to ~/.deepseek/config.json. Any config key can also be set as an environment variable.

## Models
- deepseek-v4-flash — Fast, general purpose, 1M context (default)
- deepseek-v4-pro — Advanced reasoning, 1M context

Switch with: /model <name> or /models to pick interactively.
Each provider also exposes provider-specific models (Bedrock, Vertex, local).

## Interaction Modes
Switch modes with Shift+Tab:
- Review — read-only repository inspection
- Plan — read-only exploration plus the designated plan file
- Build — normal implementation work (default)
- Auto — all native and dynamically discovered tools without interactive confirmations

Cycle: Plan -> Review -> Build -> Auto -> Plan

## Slash Commands
- /agent <name> — Load a custom agent
- /agents — List available agents (local and global)
- /model <model> — Switch model
- /models — Switch model interactively
- /language — Change preferred response language
- /theme — Change color theme
- /clear — Clear conversation history
- /compact — Summarize history to save context
- /undo — Restore last file modified by agent
- /retry — Re-run last message
- /cost — Show estimated session cost
- /files — List files modified this session
- /tools — List all available tools
- /doctor — Check runtime, workspace, credentials and MCP setup
- /verify — Run the detected project test command after confirmation
- /catalog — Show curated MCP, plugin and skill recommendations
- /system — Show active system prompt
- /sessions — List recent sessions
- /checkpoint [save|list|restore] — Manage session checkpoints
- /plan <task> — Plan implementation of a task
- /review [file] — Review project code or a specific file
- /permissions — Explain current mode, allow/deny rules, risk checks and session approvals
- /btw <question> — Ask a side question without interrupting the agent
- /vim — Toggle vim keybindings (normal/insert mode)
- /stats — Show session statistics (tokens, cost, duration, tool calls)
- /help — Show help
- /quit or /q — Exit

## Available Tools
DeepSeek Code has 24 native tools:

- \`read_file\`, \`read_folder\`, \`glob\`, \`grep\` — targeted filesystem discovery and reading
- \`lsp\` — read-only definitions, references, hover, and symbol navigation
- \`web_fetch\` — fetch a public URL as text
- \`introspect\` — show this product documentation
- \`write_file\`, \`edit_file\`, \`patch_file\` — full-file, line-level, and exact-text edits
- \`shell\` — run processes such as tests, builds, and diagnostics
- \`git\` — structured repository operations
- \`todo\`, \`memory\`, \`update_knowledge\` — session tasks, durable memory, and \`DEEPSEEK.md\` knowledge
- \`subagent\`, \`ask_agent\`, \`workflow\`, \`moa\` — focused delegation, asynchronous consultation, orchestration, and multi-model synthesis
- \`write_plan\`, \`submit_plan\` — write and submit the designated Plan-mode file
- \`get_goal\`, \`create_goal\`, \`update_goal\` — inspect, create, and change session goals

### Tool Permissions by Mode
| Mode | Permitted native tools |
| --- | --- |
| Review | \`read_file\`, \`read_folder\`, \`glob\`, \`grep\`, \`lsp\`, \`web_fetch\`, \`introspect\`, \`todo\`, \`memory\`, \`git\`, \`workflow\`, \`get_goal\` |
| Plan | \`read_file\`, \`read_folder\`, \`glob\`, \`grep\`, \`lsp\`, \`web_fetch\`, \`introspect\`, \`todo\`, \`memory\`, \`git\`, \`workflow\`, \`get_goal\`, \`write_plan\`, \`submit_plan\` |
| Build | \`read_file\`, \`read_folder\`, \`glob\`, \`grep\`, \`lsp\`, \`web_fetch\`, \`introspect\`, \`todo\`, \`memory\`, \`git\`, \`workflow\`, \`get_goal\`, \`shell\`, \`write_file\`, \`edit_file\`, \`patch_file\`, \`update_knowledge\`, \`subagent\`, \`ask_agent\`, \`moa\`, \`update_goal\` |
| Auto | All 24 native tools and dynamically discovered MCP tools |

In Review and Plan, \`git\` is limited to status/diff/log, and \`todo\` and \`memory\` are limited to list. Plan may write only through \`write_plan\`; after \`submit_plan\`, it waits for the user's decision. MCP tools follow the shell rule: Build and Auto only.

## Subagents
DeepSeek Code supports subagents — independent mini-agents spawned to handle specific subtasks.

Subagents have:
- Their own isolated context (no access to parent conversation)
- Access to all tools except subagent itself (no recursion)
- A task-specific iteration and permission budget
- The same model and provider as the parent agent

Use cases: analyzing code, refactoring files, running tests, web research.

## Custom Agents
Agents are JSON files defining a custom persona with system prompt, model, and injected files.

### File format
{
  "name": "rust-expert",
  "model": "deepseek-v4-pro",
  "systemPrompt": "You are a Rust expert. Focus on idiomatic, safe and performant code.",
  "files": ["src/**/*.rs", "Cargo.toml"]
}

### Where to save agents
- Local (project): .deepseek/agents/<name>.json
- Global (user): ~/.deepseek/agents/<name>.json

Local agents take priority over global ones when names conflict.

### Loading an agent
/agent rust-expert
deepseek agent rust-expert
deepseek agent rust-expert "explain ownership"

## Steering Files
Markdown files in .deepseek/steering/ are automatically injected into the system prompt on every session — no agent configuration needed.

## DEEPSEEK.md
If a DEEPSEEK.md file exists in the working directory, its contents are injected into the system prompt on startup alongside steering files. The agent can update it via the update_knowledge tool.

## AGENTS.md
If the project root contains AGENTS.md, DeepSeek Code loads it as interoperable repository guidance alongside DEEPSEEK.md. Use AGENTS.md for rules shared with other coding agents; use DEEPSEEK.md for DeepSeek-specific durable knowledge.

## MCP Servers
DeepSeek Code supports MCP (Model Context Protocol) servers. Project MCP servers stay disabled until you enable **Enable project MCP servers** in the User scope of /settings, then restart. MCP stdio servers receive a minimal environment; add any server-specific value explicitly in its env configuration.

### Configuration
Create .deepseek/mcp.json in the project directory:
{
  "servers": {
    "filesystem": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"]
    },
    "my-api": {
      "transport": "http",
      "url": "http://localhost:19816/mcp"
    }
  }
}

### Transports
- stdio — spawns a local process (command + args + optional env)
- http — connects to a remote MCP server via Streamable HTTP

### Tool naming
MCP tools are prefixed with the server name: serverName__toolName

## TUI Behavior
- Runs on the terminal alternate screen for clean viewport and smooth scrolling
- Thinking output is streamed as full multiline blocks and persisted
- To force main-screen mode: OTUI_USE_ALTERNATE_SCREEN=0 deepseek

## CLI Usage
deepseek                                    # interactive mode
deepseek "explain closures"                 # with initial message
deepseek agent rust-expert                  # with custom agent
deepseek agent rust-expert "explain ownership" # agent + message
deepseek --resume <session-id>             # resume a previous session
echo "task" | deepseek --pipe               # pipe mode (headless)
echo "task" | deepseek --pipe --json        # pipe mode with JSON stdout
deepseek update                             # update to latest version
deepseek logout                             # remove saved credentials

## Configuration
API key and preferences saved to ~/.deepseek/config.json.
Environment variables: DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, AWS_REGION, AWS_PROFILE, GCP_PROJECT, GCP_LOCATION, LOCAL_BASE_URL, LOCAL_MODEL

## Themes
Available: dark, light, dark-daltonized, light-daltonized, dark-ansi, light-ansi

## Open Source
DeepSeek Code is fully open-source under the Apache-2.0 license. Contributions are welcome at https://github.com/Hermenics/deepseek-code
`.trim()

export const Introspect: Tool = {
  name: 'introspect',
  description: 'Get full documentation about DeepSeek Code: what it is, how it works, available tools, agents, steering files, commands and usage. Use this when the user asks about DeepSeek Code itself.',
  parameters: { type: 'object', properties: {} },
  async execute() {
    return DOCS
  },
}
