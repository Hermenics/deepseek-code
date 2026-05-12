import { Tool } from './types.js'

const DOCS = `
# DeepSeek Code — Documentation

## What is DeepSeek Code?
DeepSeek Code is a terminal-based AI coding assistant built with Bun, OpenTUI (React for CLI) and the DeepSeek API. It runs an agent loop with streaming responses and tool calls.

## Models
- \`deepseek-v4-flash\` — DeepSeek V4 Flash: fast, general purpose, 128K context (default)
- \`deepseek-v4-pro\` — DeepSeek V4 Pro: advanced reasoning, best for complex problems
- \`deepseek-reasoner\` — DeepSeek R1: chain-of-thought reasoning

Switch with: \`/model <name>\` or use \`/models\` to pick interactively

## Slash Commands
- \`/agent <name>\` — Load a custom agent
- \`/agents\` — List available agents (local and global)
- \`/model <model>\` — Switch model
- \`/models\` — Switch model interactively
- \`/language\` — Change preferred response language
- \`/theme\` — Change color theme
- \`/clear\` — Clear conversation history
- \`/compact\` — Summarize history to save context
- \`/undo\` — Restore last file modified by agent
- \`/retry\` — Re-run last message
- \`/cost\` — Show estimated session cost
- \`/files\` — List files modified this session
- \`/tools\` — List all available tools
- \`/system\` — Show active system prompt
- \`/sessions\` — List recent sessions
- \`/checkpoint [save|list|restore]\` — Manage session checkpoints
- \`/plan <task>\` — Plan implementation of a task
- \`/review [file]\` — Review project code or a specific file
- \`/permissions\` — Show current tool permission settings
- \`/msg <note>\` — Add a background note for the agent without interrupting it
- \`/vim\` — Toggle vim keybindings (normal/insert mode)
- \`/stats\` — Show session statistics (tokens, cost, duration, tool calls)
- \`/quit\` or \`/q\` — Exit

## Available Tools
The agent has access to these tools:
- \`read_file\` — Read file contents (supports line ranges)
- \`write_file\` — Write or create a file (shows diff in UI)
- \`patch_file\` — Edit a file by replacing a specific string (more efficient than write_file)
- \`read_folder\` — List directory contents (recursive option)
- \`grep\` — Search regex pattern in files
- \`glob\` — Find files by glob pattern
- \`shell\` — Execute shell commands
- \`git\` — Execute git operations (status, diff, log, add, commit, branch, stash, pull, push)
- \`web_fetch\` — Fetch content from a URL
- \`introspect\` — Get this documentation about DeepSeek Code
- \`subagent\` — Spawn a subagent to handle a subtask independently
- \`update_knowledge\` — Record project-specific knowledge in DEEPSEEK.md
- \`todo\` — Manage a TODO list visible to the user in the UI

## Subagents
DeepSeek Code supports subagents — independent mini-agents that can be spawned to handle specific subtasks. The main agent delegates work to a subagent by calling the \`subagent\` tool with a task description.

Subagents have:
- Their own isolated context (no access to the parent's conversation history)
- Access to all tools (filesystem, shell, grep, etc.) except \`subagent\` itself (no recursion)
- A limit of 15 iterations per task
- The same model and provider as the parent agent

Example use cases:
- Analyzing a large codebase section
- Refactoring a specific file
- Running and interpreting tests
- Researching something on the web

## Custom Agents
Agents are JSON files that define a custom persona with their own system prompt, model and injected files.

### File format
\`\`\`json
{
  "name": "rust-expert",
  "model": "deepseek-reasoner",
  "systemPrompt": "You are a Rust expert. Focus on idiomatic, safe and performant code.",
  "files": ["src/**/*.rs", "Cargo.toml"]
}
\`\`\`

### Where to save agents
- Local (project): \`.deepseek/agents/<name>.json\`
- Global (user): \`~/.deepseek/agents/<name>.json\`

Local agents take priority over global ones when names conflict.

### Loading an agent
\`\`\`bash
# Via slash command
/agent rust-expert

# Via CLI on startup
deepseek agent rust-expert

# With an initial message
deepseek agent rust-expert "how does the borrow checker work?"
\`\`\`

## Steering Files
Markdown files placed in \`.deepseek/steering/\` are automatically injected into the system prompt on every session startup — no agent configuration needed.

\`\`\`bash
mkdir -p .deepseek/steering
echo "# Conventions\\nAlways use strict TypeScript." > .deepseek/steering/conventions.md
\`\`\`

## DEEPSEEK.md
If a \`DEEPSEEK.md\` file exists in the current working directory, its contents are automatically injected into the system prompt on startup, alongside steering files.

## Interaction Modes
Switch modes with Shift+Tab:
- \`Chat\` — read-only + shell (no file writes)
- \`Plan\` — read-only only (no shell, no writes)
- \`Agent\` — full access (default)
- \`Auto\` — full access, auto-confirms destructive commands

## CLI Usage
\`\`\`bash
deepseek                                    # interactive mode
deepseek "explain closures"                 # with initial message
deepseek agent rust-expert                  # with custom agent
deepseek agent rust-expert "explain ownership" # agent + initial message
deepseek --resume <session-id>              # resume a previous session
echo "task" | deepseek                      # pipe mode (headless)
deepseek update                             # update to latest version
deepseek logout                             # remove saved credentials
\`\`\`

## Configuration
API key and theme are saved to \`~/.deepseek/config.json\` after first setup.
Can also be set via environment variable: \`DEEPSEEK_API_KEY=sk-... deepseek\`

## MCP Servers
DeepSeek Code supports MCP (Model Context Protocol) servers. Tools from MCP servers are merged with native tools and available to the agent automatically.

### Configuration
Create \`.deepseek/mcp.json\` in the project directory:

\`\`\`json
{
  "servers": {
    "filesystem": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"]
    },
    "my-api": {
      "transport": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
\`\`\`

### Transports
- \`stdio\` — spawns a local process (command + args + optional env)
- \`http\` — connects to a remote MCP server via Streamable HTTP

### Tool naming
MCP tools are prefixed with the server name: \`serverName__toolName\`

## Themes
Available themes: \`dark\`, \`light\`, \`dark-daltonized\`, \`light-daltonized\`, \`dark-ansi\`, \`light-ansi\`
`.trim()

export const Introspect: Tool = {
  name: 'introspect',
  description: 'Get full documentation about DeepSeek Code: what it is, how it works, available tools, agents, steering files, commands and usage. Use this when the user asks about DeepSeek Code itself.',
  parameters: { type: 'object', properties: {} },
  async execute() {
    return DOCS
  },
}
