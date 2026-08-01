# C4 — System context

```mermaid
flowchart LR
  Dev[Developer] -->|terminal prompts, approvals| DSC[DeepSeek Code]
  DSC -->|completion / streaming APIs| Models[DeepSeek, Bedrock, Vertex, or local model provider]
  DSC -->|read, write, shell, Git| Project[Local project workspace]
  DSC -->|optional stdio| MCP[User-approved project MCP servers]
  DSC -->|optional local process| LSP[User-configured language servers]
  DSC -->|validated Git source| Extensions[Plugin and skill repositories]
  DSC -->|settings, session, memory, audit| LocalFiles[Local operational storage]
```

| Actor/system | Relationship | Confidence |
| --- | --- | --- |
| Developer | Starts the CLI, supplies prompts, chooses modes, and confirms elevated actions. | 🟢 |
| Model provider | Generates assistant content and tool-call requests through selected provider adapters. | 🟢 |
| Local workspace | Is the agent's controlled operating target. | 🟢 |
| MCP/LSP | Optional local process integrations requiring user-scope authorization. | 🟢 |
| Extension source | Supplies validated skills/plugins during explicit management commands. | 🟢 |
