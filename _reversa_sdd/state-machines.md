# Máquinas de Estado — deepseek-code

> Gerado pelo Detetive (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## 1. Interaction Mode (Agent)

🟢 CONFIRMADO — `src/ui/interactionMode.ts`

```mermaid
stateDiagram-v2
    [*] --> Build : Default ao iniciar

    Plan --> Build : Shift+Tab (user)
    Build --> Auto : Shift+Tab (user only)
    Auto --> Plan : Shift+Tab (user)

    Plan --> Build : Model pode ativar
    Build --> Plan : Model pode ativar

    note right of Auto
        Só ativável pelo usuário.
        Modelo NUNCA pode ativar Auto.
        Zero restrições de permissão.
    end note
```

### Transições

| De | Para | Gatilho | Restrição |
|----|------|---------|-----------|
| Plan | Build | Shift+Tab ou modelo | - |
| Build | Auto | Shift+Tab | Somente usuário |
| Auto | Plan | Shift+Tab | Somente usuário |
| Build | Plan | Modelo ou Shift+Tab | - |

### Permissões por Estado

| Estado | Tools Read-only | Tools Write | Shell Destrutivo | MCP |
|--------|----------------|-------------|------------------|-----|
| Plan | ✅ | ❌ | ❌ | ❌ |
| Build | ✅ | ✅ | ✅ (com confirmação) | ✅ (com confirmação) |
| Auto | ✅ | ✅ | ✅ (sem confirmação) | ✅ (sem confirmação) |

---

## 2. Agent Processing Phase

🟢 CONFIRMADO — `src/ui/App.tsx`

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Executing : User envia mensagem
    Executing --> Idle : onDone callback
    Executing --> Idle : DenyAbortError (user deny)
    Executing --> Idle : AbortController.abort (Ctrl+C)
```

### Estados

| Estado | UI | Agente |
|--------|-------|--------|
| `idle` | InputBox editável | Aguardando input |
| `executing` | LoadingSpinner | Processando (streaming + tool calls) |

---

## 3. Todo Item Status

🟢 CONFIRMADO — `src/agent/todoStore.ts`

```mermaid
stateDiagram-v2
    [*] --> Pending : addTodo()
    Pending --> InProgress : updateTodo(id, 'in_progress')
    InProgress --> Done : updateTodo(id, 'done')
    Pending --> Done : updateTodo(id, 'done')
    InProgress --> Pending : updateTodo(id, 'pending')
```

### Valores

| Status | Descrição |
|--------|-----------|
| `pending` | Tarefa criada, não iniciada |
| `in_progress` | Em execução |
| `done` | Concluída |

---

## 4. Auto-Compact State Machine

🟢 CONFIRMADO — `src/services/compact/autoCompact.ts`

```mermaid
stateDiagram-v2
    [*] --> Active : enabled=true (default)

    Active --> Compacting : contextUsage/limit > threshold
    Compacting --> Active : Sucesso (reset failures)
    Compacting --> Active : Falha (incrementa failures)
    Active --> Disabled : consecutiveFailures >= 3

    note right of Disabled
        Circuit breaker ativado.
        Requer /compact manual.
    end note
```

### Campos de Estado

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `consecutiveFailures` | number | Falhas seguidas (max 3 = desativa) |
| `lastCompactTimestamp` | number | Timestamp do último compact |

---

## 5. Tool Permission Flow

🟡 INFERIDO — `src/agent/agent.ts:914-1006`

```mermaid
stateDiagram-v2
    [*] --> ModeCheck

    ModeCheck --> Blocked : Tool não permitida no mode
    ModeCheck --> SensitiveCheck : Tool permitida

    SensitiveCheck --> AskUser : Build mode + operação sensível
    SensitiveCheck --> RuleCheck : Não sensível

    AskUser --> Denied : User diz deny
    AskUser --> SessionApproved : User diz session
    AskUser --> Proceed : User diz once

    RuleCheck --> Denied : Deny rule match
    RuleCheck --> Proceed : Allow rule match
    RuleCheck --> AskUser : Nenhum match + allow rules existem

    Proceed --> HookCheck
    SessionApproved --> HookCheck

    HookCheck --> Blocked : Hook bloqueia
    HookCheck --> Execute : Hook aprova ou pass

    Execute --> Done : Tool executada com sucesso

    Denied --> Abort : DenyAbortError
```

---

## 6. Proxy Orchestrator Stream State

🟡 INFERIDO — `src/agent/providers/proxy/services/orchestrator.ts`

```mermaid
stateDiagram-v2
    [*] --> Connecting

    Connecting --> Streaming : createDeepSeekStream ok
    Connecting --> RetryWait : Network/timeout error
    RetryWait --> Connecting : attempt < 3
    RetryWait --> Failed : attempt >= 3 ou auth error

    Streaming --> Emitting : SSE chunk received
    Emitting --> Streaming : Mais chunks esperados
    Streaming --> Done : Stream finalizado

    Failed --> [*] : Erro permanente (OAuth expired, WAF)
```
