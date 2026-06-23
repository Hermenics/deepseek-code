# Design — Módulo Tools

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Arquitetura Interna

```
┌─────────────────────────────────────────────────────┐
│                   Tool Registry                      │
│           allTools[], toolMap<name, Tool>            │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ WriteFile │  │ PatchFile│  │   ReadFile        │ │
│  └─────┬────┘  └─────┬────┘  └────────┬──────────┘ │
│        │              │                │             │
│        └──────────────┼────────────────┘             │
│                       ▼                              │
│              ┌────────────────┐                      │
│              │  Path Safety   │                      │
│              │ assertSafePath │                      │
│              └────────────────┘                      │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │  Shell   │  │   Git    │  │   WebFetch        │ │
│  └──────────┘  └──────────┘  └───────────────────┘ │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │  Grep    │  │   Glob   │  │   ReadFolder      │ │
│  └──────────┘  └──────────┘  └───────────────────┘ │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ SubAgent │  │   Todo   │  │ Introspect/UKnow  │ │
│  └──────────┘  └──────────┘  └───────────────────┘ │
└─────────────────────────────────────────────────────┘
```

---

## Componentes

### 1. Tool Registry (`index.ts`) 🟢

**Responsabilidade:** Registra e expõe todas as tools disponíveis.

**Exportações:**
- `allTools: Tool[]` — array completo para injetar no LLM
- `toolMap: Map<string, Tool>` — lookup por nome para execução

### 2. Path Safety (`shared/pathSafety.ts`) 🟢

**Responsabilidade:** Validar que caminhos estão dentro do sandbox.

**Regras:**
1. Resolve path absoluto relativo ao cwd
2. Checa `realpath` para bloquear symlink traversal
3. Bloqueia diretórios: `.agent`, `.claude`, `.kiro`, `.github`, `.deepseek`, `node_modules`, `dist`, `build`, `.git`
4. Bloqueia arquivos sensíveis: `.env*`, `*.pem`, `*.key`, `credentials.*`, `secrets.*`, SSH keys, AWS/GCP config

**API:**
```
assertSafePath(path: string, cwd: string): void  // throws se inseguro
```

### 3. WriteFile (`WriteFile/WriteFile.ts`) 🟢

**Responsabilidade:** Escrita completa de arquivo com diff.

**Fluxo:**
1. `assertSafePath(path)`
2. Lê conteúdo anterior (se existir)
3. Escreve novo conteúdo no disco
4. Computa diff LCS (guard: > 5000 linhas → summary)
5. Retorna diff formatado como resultado

**Diff Algorithm (LCS):**
- Dynamic Programming: `dp[i][j] = longest common subsequence`
- Produz hunks no formato unified diff
- Shared com PatchFile (mesmo `computeDiff`)

### 4. PatchFile (`PatchFile/PatchFile.ts`) 🟢

**Responsabilidade:** Substituição cirúrgica de texto.

**Fluxo:**
1. `assertSafePath(path)`
2. Lê conteúdo do arquivo
3. Conta ocorrências de `old_content`:
   - 0 → erro "not found"
   - 1 → substitui por `new_content`
   - \>1 → erro "ambiguous, found N matches"
4. Escreve arquivo atualizado
5. Computa e retorna diff LCS

### 5. ReadFile (`ReadFile/ReadFile.ts`) 🟢

**Responsabilidade:** Leitura segura de arquivos.

**Fluxo:**
1. `assertSafePath(path)`
2. Lê e retorna conteúdo
3. Se binário detectado → retorna aviso

### 6. ReadFolder (`ReadFolder/ReadFolder.ts`) 🟢

**Responsabilidade:** Listagem de diretório.

**Fluxo:**
1. `assertSafePath(path)`
2. `readdir` com tipos (file, dir, symlink)
3. Formata: `type name size`

### 7. Shell (`Shell/Shell.ts`) 🟢

**Responsabilidade:** Execução de comandos com proteções.

**Fluxo:**
1. Checa patterns destrutivos: `rm -rf /`, `git reset --hard`, `mkfs`, `dd if=`, `chmod -R 777`, etc.
2. Se destrutivo → solicita confirmação ao agent (que repassa ao user)
3. Executa via `execa(command, { shell: true, timeout: 30000 })`
4. Captura stdout + stderr
5. Trunca a 50k chars se necessário
6. Retorna output

**Patterns destrutivos (amostra):**
```
/rm\s+(-[rf]+\s+)*\//
/git\s+(reset\s+--hard|clean\s+-fd)/
/mkfs/
/dd\s+if=/
/:(){ :|:& };:/  (fork bomb)
```

### 8. Git (`Git/Git.ts`) 🟢

**Responsabilidade:** Operações git com proteções.

**Fluxo:**
1. Valida comando
2. Se push com force → substitui `--force` por `--force-with-lease`
3. Executa via execa
4. Retorna output

### 9. WebFetch (`WebFetch/WebFetch.ts`) 🟢

**Responsabilidade:** HTTP fetch com SSRF protection.

**Fluxo de validação SSRF:**
1. Parse URL → extrai hostname
2. Resolve DNS → obtém IP(s)
3. Valida cada IP contra blocklist:
   - `127.0.0.0/8` (loopback)
   - `10.0.0.0/8` (private A)
   - `172.16.0.0/12` (private B)
   - `192.168.0.0/16` (private C)
   - `169.254.0.0/16` (link-local / metadata)
   - `::1`, `fe80::/10` (IPv6 equivalents)
4. Se IP bloqueado → erro
5. Fetch com timeout
6. Strip HTML → retorna texto limpo

### 10. Grep (`Grep/Grep.ts`) 🟢

**Responsabilidade:** Busca por conteúdo em arquivos.

**Parâmetros:** `{ pattern, path, include?, case_sensitive? }`
**Limite:** 200 linhas de resultado (GREP_MAX_LINES)
**Implementação:** Regex match line-by-line com path safety check

### 11. Glob (`Glob/Glob.ts`) 🟢

**Responsabilidade:** Busca por nome de arquivo via glob patterns.

**Parâmetros:** `{ pattern }`
**Limite:** 500 arquivos (GLOB_MAX_FILES)
**Segurança:** 
- BLOCKED_GLOB_PATTERNS: patterns que matcham demais (ex: `**/*`)
- Matching iterativo (anti-ReDoS), max 10 wildcards por pattern

### 12. SubAgent (`SubAgent/SubAgent.ts`) 🟢

**Responsabilidade:** Loop independente para subtarefas.

**Comportamento:**
- Herda provider e permissions do parent
- Acesso a todas as tools EXCETO subagent (previne recursão infinita)
- Max 15 iterações (SUBAGENT_MAX_ITERATIONS)
- Retorna resultado final como string

### 13. Todo (`Todo/Todo.ts`) 🟢

**Responsabilidade:** CRUD de todo items no state store.

**Operações:** create, update, delete, list
**Status:** pending → in_progress → done
**Persistência:** In-memory (state store), não sobrevive entre sessões

### 14. Introspect (`Introspect/Introspect.ts`) 🟢

**Responsabilidade:** Retorna meta-informação do agente.

**Retorno:** model, provider, tokenCount, contextUsage, contextLimit, activeAgent

### 15. UpdateKnowledge (`UpdateKnowledge/UpdateKnowledge.ts`) 🟢

**Responsabilidade:** Atualiza arquivos de steering/knowledge persistidos.

**Restrição:** Só escreve em `.deepseek/` (não usa assertSafePath padrão, tem regra própria)

---

## Decisões de Design

| Decisão | Rationale | Confiança |
|---------|-----------|-----------|
| Interface `execute() → string` | Simplicidade: LLM recebe sempre texto como tool result | 🟢 |
| LCS diff compartilhado (WriteFile + PatchFile) | DT1: código duplicado, mas funciona | 🟢 |
| Guard de 5000 linhas no diff | Previne OOM em arquivos grandes | 🟢 |
| SubAgent sem acesso a subagent | Previne recursão infinita sem limite | 🟢 |
| Shell patterns destrutivos como regex | Simples de manter, cobre os casos mais perigosos | 🟢 |
| SSRF por IP (não só hostname) | Previne bypass via DNS rebinding | 🟢 |
| Glob iterativo | Imune a ReDoS (não usa regex backtracking) | 🟢 |

---

## Parallel Safety

| Tool | Parallel-safe? | Motivo |
|------|---------------|--------|
| read_file | ✅ | Apenas leitura |
| read_folder | ✅ | Apenas leitura |
| grep | ✅ | Apenas leitura |
| glob | ✅ | Apenas leitura |
| web_fetch | ✅ | Stateless HTTP |
| introspect | ✅ | Apenas leitura de state |
| subagent | ✅ | Loop independente |
| shell | ✅ | Processos independentes |
| write_file | ❌ | Modifica filesystem |
| patch_file | ❌ | Modifica filesystem |
| git | ❌ | Modifica repositório |
| todo | ❌ | Modifica state |
| update_knowledge | ❌ | Modifica filesystem |
