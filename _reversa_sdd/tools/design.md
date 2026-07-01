# Tools Module — Design

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Architecture

Each tool is a self-contained module exporting a `Tool` interface object. Tools are collected in `src/tools/index.ts` and registered into the Agent's tool map at initialization.

## Structure

```
tools/
├── index.ts              — exports allTools array
├── types.ts              — Tool interface definition
├── shared/
│   └── pathSafety.ts     — path validation, blocked dirs, sensitive files
├── Shell/Shell.ts        — shell command execution
├── ReadFile/ReadFile.ts  — file reading
├── WriteFile/WriteFile.ts — file creation/overwrite
├── PatchFile/PatchFile.ts — unified diff application
├── ReadFolder/ReadFolder.ts — directory listing
├── Glob/Glob.ts          — pattern-based file search
├── Grep/Grep.ts          — content search
├── Git/Git.ts            — git operations
├── WebFetch/WebFetch.ts  — URL fetch with SSRF protection
├── SubAgent/
│   ├── SubAgent.ts       — spawn child agent
│   ├── permissions.ts    — role inference and tool filtering
│   └── memory.ts         — cross-subagent memory
├── MoA/
│   ├── index.ts          — MoA tool definition
│   ├── executor.ts       — parallel model querying + synthesis
│   ├── types.ts          — MoA interfaces
│   └── defaults.ts       — default model configuration
├── Todo/Todo.ts          — TODO list management
├── Introspect/Introspect.ts — system state queries
└── UpdateKnowledge/UpdateKnowledge.ts — memory write
```

## Tool Interface

```typescript
interface Tool {
  name: string
  description: string
  parameters: object  // JSON Schema
  execute(args: Record<string, unknown>): Promise<string>
}
```

## Key Patterns

### Path Safety (shared)
All file tools call `assertSafePath()` which enforces:
1. CWD containment (resolved path inside process.cwd())
2. Blocked directory check (9 dirs)
3. Symlink traversal prevention (realpath check)
4. Sensitive file pattern matching (25+ patterns)

### SSRF Protection (WebFetch)
Two-phase validation:
1. Pre-fetch: `isBlockedUrl()` checks hostname against known private ranges
2. Post-DNS: `isPrivateIp()` checks resolved IP (prevents DNS rebinding)

### SubAgent Role Pipeline
```
Task description → inferRole(task) → SubAgentRole
  → getToolsForRole(role, allTools) → filtered Tool[]
  → spawn Agent with filtered tools
  → 15-iteration limit
  → verify result
  → return to parent
```
