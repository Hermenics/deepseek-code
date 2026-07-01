# Hooks Module — Design

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Architecture

Hooks execute as shell commands via `child_process.spawn`. Input is sent as JSON to stdin, output is captured from stdout.

## Structure

```
hooks/
├── index.ts          — re-exports
├── types.ts          — HooksConfig, HookCommand, HookMatcher, HookInput, PreToolHookOutput
├── matcher.ts        — matchesHookPattern() — tool name matching
├── executor.ts       — runHookCommand(), runPreToolHooks(), runPostToolHooks(), runSessionStartHooks()
└── useToolPermission.ts — React hook for UI permission prompt
```

## Hook Execution Flow

```
PreToolUse:
  for each matcher in config.PreToolUse:
    if matchesHookPattern(matcher, toolName):
      for each hook in matcher.hooks:
        spawn sh -c "command"
        write JSON to stdin
        read stdout
        parse as JSON
        if decision == "block": return block
        if modified_input: update input for next hook
  return approve (with possibly modified input)

PostToolUse:
  for each matcher in config.PostToolUse:
    if matches: run hooks (ignore errors)

SessionStart:
  for each hook in config.SessionStart:
    run (ignore errors)
```

## Protocol

**Input (stdin):**
```json
{
  "event": "PreToolUse",
  "session_id": "uuid",
  "tool_name": "shell",
  "tool_input": {"command": "ls"},
  "tool_result": "..." // only PostToolUse
}
```

**Output (stdout, PreToolUse only):**
```json
{
  "decision": "approve" | "block",
  "reason": "optional explanation",
  "modified_input": {"command": "ls -la"} // optional
}
```
