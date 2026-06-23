# ERD — deepseek-code

> Gerado pelo Arquiteto (Reversa) em 2026-06-23
> Nota: Este projeto não usa banco de dados relacional. O ERD representa as entidades persistidas em JSON.

```mermaid
erDiagram
    SESSION {
        string id PK "hex 12 chars"
        string createdAt "ISO 8601"
        string updatedAt "ISO 8601"
        string cwd "working directory"
        string model "modelo ativo"
        string provider "provider ativo"
        string language "idioma ou null"
        string activeAgent "agente custom ou null"
    }

    CHECKPOINT {
        string id PK "timestamp-randomHex"
        string timestamp "ISO 8601"
        string label "rótulo humano"
    }

    AGENT_CONFIG {
        string name PK "identificador"
        string model "override de modelo"
        string systemPrompt "prompt custom"
        string source "local ou global"
    }

    SETTINGS {
        string level PK "user, project, local"
        string model "override modelo"
        string theme "tema visual"
        string language "idioma"
        boolean autoCompact "flag"
        number autoCompactThreshold "0.0-1.0"
    }

    PERMISSION_RULE {
        string raw "Shell(git *)"
        string toolName "shell"
        string pattern "git *"
    }

    HOOK_MATCHER {
        string matcher "Shell|WriteFile"
        string event "PreToolUse, PostToolUse"
    }

    HOOK_COMMAND {
        string type "command"
        string command "shell cmd"
        number timeout "seconds"
    }

    TODO_ITEM {
        string id PK "hex 8 chars"
        string title "descrição"
        string status "pending|in_progress|done"
    }

    AUDIT_EVENT {
        string ts "ISO 8601"
        string type "session_start|tool_call|..."
        string tool "nome da tool"
        number durationMs "duração execução"
    }

    MCP_SERVER {
        string name PK "identificador"
        string transport "stdio ou http"
        string command "comando de start"
    }

    SESSION ||--o{ CHECKPOINT : "pode ter"
    SESSION ||--o{ AUDIT_EVENT : "gera"
    SESSION ||--o{ TODO_ITEM : "contém"
    SETTINGS ||--o{ PERMISSION_RULE : "define allow/deny"
    SETTINGS ||--o{ HOOK_MATCHER : "configura hooks"
    HOOK_MATCHER ||--|{ HOOK_COMMAND : "contém"
    AGENT_CONFIG }o--|| SESSION : "pode estar ativo em"
```

## Cardinalidades

| Relação | Cardinalidade | Nota |
|---------|---------------|------|
| Session → Checkpoint | 1:N | Max 20 checkpoints globais |
| Session → AuditEvent | 1:N | Um arquivo JSONL por sessão |
| Session → TodoItem | 1:N | In-memory, não persistido |
| Settings → PermissionRule | 1:N | Arrays allow[] e deny[] |
| Settings → HookMatcher | 1:N | Por evento (Pre/Post/Session) |
| HookMatcher → HookCommand | 1:N | Lista de hooks por matcher |
| AgentConfig → Session | N:1 | Um agent ativo por sessão |

## Persistência

| Entidade | Formato | Local |
|----------|---------|-------|
| Session | JSON | `~/.deepseek/sessions/{id}.json` |
| Checkpoint | JSON | `~/.deepseek/checkpoints/{id}.json` |
| AgentConfig | JSON | `.deepseek/agents/` ou `~/.deepseek/agents/` |
| Settings | JSON | `~/.deepseek/settings.json`, `.deepseek/settings.json`, `.deepseek/settings.local.json` |
| AuditEvent | JSONL | `~/.deepseek/logs/session-{id}.jsonl` |
| TodoItem | In-memory | Não persistido entre sessões |
| History | JSON | `~/.deepseek/history.json` (max 500 msgs) |
