import { Tool } from './types.js'

const DOCS = `
# DeepSeek Code — Documentation

## What is DeepSeek Code?
DeepSeek Code is a terminal-based AI coding assistant built with Bun, Ink (React for CLI) and the DeepSeek API. It runs an agent loop with streaming responses and tool calls.

## Models
- \`deepseek-chat\` — DeepSeek-V3: fast, general purpose, 128K context
- \`deepseek-reasoner\` — DeepSeek-R1: chain-of-thought reasoning, best for complex problems

Switch with: \`/model deepseek-chat\` or \`/model deepseek-reasoner\`

## Slash Commands
- \`/agent <name>\` — Load a custom agent
- \`/agents\` — List available agents (local and global)
- \`/model <model>\` — Switch model
- \`/clear\` — Clear conversation history
- \`/help\` — Show available commands
- \`/quit\` or \`/q\` — Exit

## Available Tools
The agent has access to these tools:
- \`read_file\` — Read file contents (supports line ranges)
- \`write_file\` — Write or create a file
- \`read_folder\` — List directory contents (recursive option)
- \`grep\` — Search regex pattern in files
- \`glob\` — Find files by glob pattern
- \`shell\` — Execute shell commands
- \`introspect\` — Get this documentation about DeepSeek Code
- \`web_fetch\` — Fetch content from a URL

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
bun run start agent rust-expert

# With an initial message
bun run start agent rust-expert "how does the borrow checker work?"
\`\`\`

When an agent is loaded, a message shows whether it came from local (overrides global) or global scope.

## Steering Files
Markdown files placed in \`.deepseek/steering/\` are automatically injected into the system prompt on every session startup — no agent configuration needed.

\`\`\`bash
mkdir -p .deepseek/steering
echo "# Conventions\\nAlways use strict TypeScript." > .deepseek/steering/conventions.md
\`\`\`

## DEEPSEEK.md
If a \`DEEPSEEK.md\` file exists in the current working directory, its contents are automatically injected into the system prompt on startup, alongside steering files.

## CLI Usage
\`\`\`bash
deepseek                                    # interactive mode
deepseek "explain closures"                 # with initial message
deepseek agent rust-expert                  # with custom agent
deepseek agent rust-expert "explain ownership" # agent + initial message
\`\`\`

## Configuration
API key and theme are saved to \`~/.deepseek-code/config.json\` after first setup.
Can also be set via environment variable: \`DEEPSEEK_API_KEY=sk-... bun run start\`

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
