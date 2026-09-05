# Settings

Open `/config` or `/settings` to use the fullscreen settings center. Press `/` to search, `Tab` to cycle the edited scope, `Enter` to edit, `r` to remove the selected override, and `Esc` to move back or close.

## Files and precedence

Settings merge in this order:

1. `~/.deepseek/settings.json` — User
2. `<project>/.deepseek/settings.json` — Project
3. `<project>/.deepseek/settings.local.json` — Local

The UI shows the effective value, its origin, the override chain and whether the selected scope inherits it. Writes are atomic and preserve unknown JSON keys. Invalid JSON is reported and blocks field writes until the file is corrected. Executable hooks, language servers, and project MCP consent are accepted only at User scope.

Credentials and other secrets remain exclusively in `~/.deepseek/config.json`. Theme, language, provider metadata and other non-secret preferences belong in settings. Legacy keys remain readable during this compatibility cycle.

## Top-level schema

```text
provider       provider name, endpoint, region/profile, project/location, timeout
model          default and subagent model, maxOutputTokens (max_tokens ceiling; DeepSeek API defaults to 32768, or 8192 at low effort), temperature (0–2, provider default when unset)
interaction    defaultMode: build | plan | review | auto
compaction     enabled, threshold (0.70–0.95)
promptRefiner  enabled, model, minimumLength, excludeTypes
permissions    allow, deny, suppress, autoApproveLowRisk
risk           enabled, thresholds, custom rules
agents         default, additionalDirectories, basePrompt, concurrency, permissionPolicy
memory         enabled, scope: user | project
sessions       retention, autoResume: off | project-last
git            checkpoint, worktree, branchPattern, reviewDiff, generatedPatterns
lsp            user-scoped language-server commands and timeout
mcp            user-scoped opt-in to load .deepseek/mcp.json (disabled by default)
interface      theme, language, vim, density, motion, visibility, status bar
hooks          PreToolUse, PostToolUse and SessionStart
```

Arrays of permission and risk rules inherit. `permissions.suppress` can suppress an inherited allow rule by exact text; deny rules and high-risk rules cannot be suppressed. A Project or Local setting cannot silently choose Auto as the default mode or enable MCP servers.

## Agents

The registry loads built-ins, `~/.deepseek/agents`, `.deepseek/agents`, `.deepseek/agents.local`, and configured extra directories. Later scopes override earlier scopes. Legacy JSON agents default to primary use, avoiding unexpected delegation.

An agent can set `usage` (`primary`, `subagent`, or `both`), `role`, `enabled`, `model`, `color`, `tools`, `permissions`, `extends`, and `systemPrompt`. The editable subagent base prompt is composed before the specialization. The executor's required structured-result protocol is protected and shown separately in the TUI.

## Runtime application

Theme, language, Vim mode, model, prompt refinement, permissions, concurrency, memory policy and status-bar changes apply to the running process. Provider/endpoint, alternate screen, default agent and auto-resume changes are marked for the next session.
