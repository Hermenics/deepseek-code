# Design — Módulo Hooks

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Arquitetura Interna

```
┌─────────────────────────────────────────────┐
│              Hook Engine                      │
├─────────────────────────────────────────────┤
│                                               │
│  ┌──────────────┐    ┌────────────────────┐  │
│  │   Matcher    │    │    Executor        │  │
│  │              │    │                    │  │
│  │ toolName →   │    │ spawn(command)     │  │
│  │ matchHooks[] │    │ stdin: JSON        │  │
│  │              │    │ stdout: JSON       │  │
│  └──────────────┘    │ timeout: 30s       │  │
│                       └────────────────────┘  │
│                                               │
│  Events:                                      │
│  ┌───────────┐ ┌────────────┐ ┌───────────┐ │
│  │PreToolUse │ │PostToolUse │ │SessionStart│ │
│  │(blocking) │ │(fire&forget)│ │(blocking) │ │
│  └───────────┘ └────────────┘ └───────────┘ │
└─────────────────────────────────────────────┘
```

---

## Componentes

### 1. Matcher 🟢

**Responsabilidade:** Dado um tool name e event type, retorna hooks aplicáveis.

**Lógica:**
```
para cada hookConfig em settings.hooks[event]:
  se hookConfig.matcher === "*" → match
  se hookConfig.matcher contém toolName (pipe-separated) → match
retorna matched hooks
```

### 2. Executor 🟢

**Responsabilidade:** Executa hook command via child_process.spawn.

**Protocolo:**
- **Input (stdin):** JSON com contexto do evento
  ```json
  {
    "event": "PreToolUse",
    "tool": "shell",
    "args": { "command": "rm -rf /" },
    "cwd": "/path/to/project"
  }
  ```
- **Output (stdout):** JSON com decisão
  ```json
  { "action": "block", "reason": "Destructive command detected" }
  ```
  ou
  ```json
  { "action": "allow" }
  ```
- **Timeout:** 30s default (configurável por hook)
- **Error handling:** Timeout ou crash → tratado como "allow" para PreToolUse, ignorado para Post

### 3. Integration Points 🟢

**PreToolUse:**
```
Agent.checkAndExecuteTool(call):
  1. matchHooks("PreToolUse", call.name)
  2. Para cada hook matched:
     result = executor.run(hook, context)
     se result.action === "block" → return error
  3. Prossegue com execução da tool
```

**PostToolUse:**
```
Agent.checkAndExecuteTool(call):
  ... (após tool executar)
  7. matchHooks("PostToolUse", call.name)
  8. Para cada hook matched:
     executor.run(hook, context)  // fire-and-forget (não await)
```

**SessionStart:**
```
Agent.initialize():
  3. matchHooks("SessionStart", "*")
  4. Para cada hook matched:
     result = executor.run(hook, context)
```

---

## Settings Schema 🟢

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Shell|WriteFile",
        "command": "/path/to/my-hook.sh",
        "timeout": 30
      }
    ],
    "PostToolUse": [...],
    "SessionStart": [...]
  }
}
```

---

## Decisões de Design

| Decisão | Rationale | Confiança |
|---------|-----------|-----------|
| Shell commands (não plugins JS) | Isolamento: hooks rodam em processo separado, qualquer linguagem | 🟢 |
| JSON via stdin/stdout | Protocolo simples, sem dependências | 🟢 |
| User-level only | Previne repos maliciosos de executarem código arbitrário | 🟢 |
| PostToolUse fire-and-forget | Não penaliza latência do fluxo principal | 🟢 |
| Timeout com fallback allow | Preferível falhar aberto do que travar a sessão | 🟡 |
