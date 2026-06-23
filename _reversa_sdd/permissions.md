# Permissões — deepseek-code

> Gerado pelo Detetive (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Modelo de Permissões

O sistema não possui papéis de usuário (RBAC) tradicionais — é uma CLI single-user. O controle de acesso opera em **três camadas ortogonais**:

1. **Interaction Mode** — controla quais categorias de tools são permitidas
2. **Permission Rules** — allow/deny com glob matching sobre tools específicas
3. **Hooks** — shell commands externos que podem bloquear ou modificar tool calls

---

## Camada 1: Interaction Modes

🟢 CONFIRMADO — `src/ui/interactionMode.ts`

| Tool | Plan | Build | Auto |
|------|------|-------|------|
| read_file | ✅ | ✅ | ✅ |
| read_folder | ✅ | ✅ | ✅ |
| glob | ✅ | ✅ | ✅ |
| grep | ✅ | ✅ | ✅ |
| git | ✅ | ✅ | ✅ |
| web_fetch | ✅ | ✅ | ✅ |
| introspect | ✅ | ✅ | ✅ |
| todo | ✅ | ✅ | ✅ |
| subagent | ✅ | ✅ | ✅ |
| shell | ❌ | ✅ | ✅ |
| write_file | ❌ | ✅ | ✅ |
| patch_file | ❌ | ✅ | ✅ |
| update_knowledge | ❌ | ✅ | ✅ |
| MCP tools (contém `__`) | ❌ | ✅ | ✅ |

**Nota:** Auto mode não consulta esta tabela — retorna `true` para qualquer tool.

---

## Camada 2: Permission Rules (settings.json)

🟢 CONFIRMADO — `src/permissions/matcher.ts`

### Sintaxe

```
"Shell(git *)"      → tool Shell, pattern "git *" matchado contra o command
"ReadFile"          → tool ReadFile, qualquer argumento
"WriteFile(*.env)"  → tool WriteFile, pattern "*.env" matchado contra o path
```

### Resolução

```
1. Parse deny rules
2. Parse allow rules
3. Para cada deny rule: se match → DENY (para imediatamente)
4. Para cada allow rule: se match → ALLOW
5. Fallback:
   - Se allow rules existem mas nenhuma matchou → ASK (pede confirmação)
   - Se só deny rules existem e nenhuma matchou → ALLOW
   - Se nenhuma rule existe → ALLOW
```

### Content Matching por Tool

| Tool | Campo matchado |
|------|----------------|
| shell | `args.command` |
| read_file / write_file / patch_file | `args.path` |
| web_fetch | `args.url` |
| grep | `args.pattern` |
| outras | Sem pattern matching (match por nome apenas) |

### Decisões do Usuário

| Decisão | Efeito |
|---------|--------|
| `once` | Permite esta execução apenas |
| `session` | Adiciona ao sessionApprovedTools (válido até fim da sessão) |
| `always` | Persiste em `~/.deepseek/settings.json` → `permissions.allow[]` |
| `deny` | Throws DenyAbortError → aborta o turno do agente |

---

## Camada 3: Hooks (PreToolUse)

🟢 CONFIRMADO — `src/hooks/executor.ts`

### Decisões possíveis de um hook

| Decisão | Efeito |
|---------|--------|
| `approve` | Permite execução (pode incluir `modified_input`) |
| `block` | Bloqueia execução com reason |
| _(stdout vazio/não-JSON)_ | Ignora, prossegue |

### Segurança de Hooks

| Regra | Implementação |
|-------|---------------|
| Hooks só de user-level | `settings/loader.ts` stripa hooks de project/local |
| Timeout | Default 30s por hook command |
| Falha de hook | Retorna JSON `{decision: "block", reason: "..."}` |
| PostToolUse | Fire-and-forget, erros ignorados |
| tool_result no PostToolUse | Truncado a 10k chars |

---

## Camada Especial: Agent-level allowedTools

🟢 CONFIRMADO — `src/agent/config.ts` + `src/agent/agent.ts:984-1005`

Custom agents podem definir `allowedTools`:
- `null` ou omitido → sem restrição adicional
- `string[]` → whitelist: tools fora da lista são bloqueadas
- `'*'` → todas as tools requerem confirmação individual

---

## Ordem de Avaliação Completa

🟢 CONFIRMADO — `src/agent/agent.ts:914-1057`

```
1. Auto mode? → SKIP TUDO, vai direto para hooks
2. canUseTool(mode, tool)? → Bloqueia se mode não permite
3. Build mode + sensitive? → Pede confirmação para shell destrutivo ou config write
4. Permission rules (deny → allow → ask)
5. allowedTools agent config (whitelist ou '*')
6. PreToolUse hooks (pode bloquear ou modificar)
7. Undo snapshot (se write/patch)
8. Execute tool
9. PostToolUse hooks (fire-and-forget)
```

---

## Operações Sensíveis no Build Mode

🟢 CONFIRMADO — `src/ui/interactionMode.ts:69-83`

Patterns que requerem confirmação explícita:

| Pattern | Exemplo |
|---------|---------|
| `rm -rf` / `rm -r` / `rm -f` | `rm -rf node_modules` |
| `rmdir` | `rmdir old_dir` |
| `git reset --hard` | - |
| `git clean` | `git clean -fd` |
| `git push --force` / `-f` | - |
| `git checkout -- .` | - |
| `git restore .` | - |
| `chmod -R` | `chmod -R 777 /tmp` |
| `chown -R` | - |
| `dd` | `dd if=/dev/zero of=...` |
| `mkfs` | - |
| `fdisk` | - |

Além disso: qualquer write em `.deepseek/` (config write) requer confirmação.
