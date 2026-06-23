# Tasks — Módulo Tools

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Tasks de Reimplementação

### T-TL-01: Tool Registry 🟢

**Fonte:** `src/tools/index.ts`
**Descrição:** Implementar registro central de tools com array e map de lookup.

**Critério de pronto:**
- `allTools[]` com todas as 13 tools para injeção no LLM
- `toolMap` com lookup O(1) por nome
- Cada tool exporta interface padronizada { name, description, parameters, execute }

**Confiança:** 🟢

---

### T-TL-02: Path Safety 🟢

**Fonte:** `src/tools/shared/pathSafety.ts`
**Descrição:** Implementar validação de caminhos (sandbox, symlinks, sensíveis).

**Critério de pronto:**
- Resolve path absoluto relativo ao cwd
- Bloqueia symlinks que escapam do sandbox (via realpath)
- Bloqueia diretórios: .agent, .claude, .kiro, .github, .deepseek, node_modules, dist, build, .git
- Bloqueia extensões/nomes sensíveis: .env*, *.pem, *.key, credentials.*, secrets.*, SSH keys
- Throws com mensagem clara quando violado

**Confiança:** 🟢

---

### T-TL-03: WriteFile 🟢

**Fonte:** `src/tools/WriteFile/WriteFile.ts`
**Descrição:** Implementar escrita completa de arquivo com diff LCS.

**Critério de pronto:**
- Valida path via assertSafePath
- Lê conteúdo anterior (se existir)
- Escreve novo conteúdo
- Computa diff LCS (unified format)
- Guard: > 5000 linhas retorna summary
- Cria diretórios intermediários se necessário

**Confiança:** 🟢

---

### T-TL-04: PatchFile 🟢

**Fonte:** `src/tools/PatchFile/PatchFile.ts`
**Descrição:** Implementar substituição exata de texto com validação de unicidade.

**Critério de pronto:**
- Valida path via assertSafePath
- Conta ocorrências de old_content no arquivo
- 0 matches → erro "not found"
- 1 match → substitui, computa diff, retorna
- \>1 match → erro "ambiguous, found N matches"
- Preserva encoding original

**Confiança:** 🟢

---

### T-TL-05: ReadFile 🟢

**Fonte:** `src/tools/ReadFile/ReadFile.ts`
**Descrição:** Implementar leitura segura de arquivo.

**Critério de pronto:**
- Valida path via assertSafePath
- Retorna conteúdo como string
- Detecta binário e retorna aviso ao invés de conteúdo
- Suporta offset/limit para leitura parcial

**Confiança:** 🟢

---

### T-TL-06: ReadFolder 🟢

**Fonte:** `src/tools/ReadFolder/ReadFolder.ts`
**Descrição:** Implementar listagem de diretório.

**Critério de pronto:**
- Valida path via assertSafePath
- Lista entries com tipo (file/dir/symlink) e tamanho
- Formata output legível

**Confiança:** 🟢

---

### T-TL-07: Shell 🟢

**Fonte:** `src/tools/Shell/Shell.ts`
**Descrição:** Implementar execução de comandos com detecção de destrutivos.

**Critério de pronto:**
- Regex patterns para detectar: rm -rf, git reset --hard, mkfs, dd if=, fork bomb, chmod -R 777
- Se destrutivo → retorna flag para confirmação
- Executa via execa com shell: true
- Timeout: 30s (SHELL_TIMEOUT_MS)
- Output truncado a 50k chars (SHELL_OUTPUT_MAX_CHARS)
- Captura stdout + stderr combinados

**Confiança:** 🟢

---

### T-TL-08: Git 🟢

**Fonte:** `src/tools/Git/Git.ts`
**Descrição:** Implementar operações git com proteções.

**Critério de pronto:**
- Executa comandos git via execa
- Intercepta --force e substitui por --force-with-lease
- Detecta operações destrutivas (reset --hard, clean -fd)
- Retorna output formatado

**Confiança:** 🟢

---

### T-TL-09: WebFetch com SSRF Protection 🟢

**Fonte:** `src/tools/WebFetch/WebFetch.ts`
**Descrição:** Implementar HTTP fetch com blocklist de IPs.

**Critério de pronto:**
- Parse URL e resolve DNS
- Valida IP contra blocklist: 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, ::1, fe80::/10
- Fetch com timeout configurável
- Strip HTML tags → retorna texto limpo
- Suporta redirect (re-valida IP do destino)

**Confiança:** 🟢

---

### T-TL-10: Grep 🟢

**Fonte:** `src/tools/Grep/Grep.ts`
**Descrição:** Implementar busca por padrão em arquivos.

**Critério de pronto:**
- Aceita: pattern, path, include filter, case_sensitive flag
- Match line-by-line com regex
- Retorna: arquivo:linha:conteúdo
- Trunca a 200 linhas (GREP_MAX_LINES)
- Respeita path safety (ignora paths fora do sandbox)

**Confiança:** 🟢

---

### T-TL-11: Glob 🟢

**Fonte:** `src/tools/Glob/Glob.ts`
**Descrição:** Implementar busca de arquivos por pattern com proteções.

**Critério de pronto:**
- Matching iterativo (não usa regex — anti-ReDoS)
- Limite de 10 wildcards por pattern
- Bloqueia BLOCKED_GLOB_PATTERNS
- Trunca a 500 resultados (GLOB_MAX_FILES)
- Case-insensitive matching

**Confiança:** 🟢

---

### T-TL-12: SubAgent 🟢

**Fonte:** `src/tools/SubAgent/SubAgent.ts`
**Descrição:** Implementar loop independente para subtarefas.

**Critério de pronto:**
- Herda provider e permissions do parent
- Tem acesso a todas tools EXCETO subagent
- Max 15 iterações (abort com resultado parcial)
- Retorna resultado final como string concatenada

**Confiança:** 🟢

---

### T-TL-13: Todo 🟢

**Fonte:** `src/tools/Todo/Todo.ts`
**Descrição:** Implementar CRUD de todo items.

**Critério de pronto:**
- Operações: create, update, delete, list
- Status: pending → in_progress → done
- Armazena no state store (pub/sub)
- IDs gerados como hex 8 chars

**Confiança:** 🟢

---

### T-TL-14: Introspect 🟢

**Fonte:** `src/tools/Introspect/Introspect.ts`
**Descrição:** Implementar retorno de meta-informação do agente.

**Critério de pronto:**
- Retorna: model, provider, tokenCount, contextUsage, contextLimit, activeAgent
- Lê do state store

**Confiança:** 🟢

---

### T-TL-15: UpdateKnowledge 🟢

**Fonte:** `src/tools/UpdateKnowledge/UpdateKnowledge.ts`
**Descrição:** Implementar atualização de arquivos de steering.

**Critério de pronto:**
- Escreve apenas dentro de `.deepseek/`
- Valida que path não escapa para fora
- Cria arquivo se não existe, atualiza se existe

**Confiança:** 🟢

---

### T-TL-16: LCS Diff (Shared) 🟢

**Fonte:** `src/tools/WriteFile/WriteFile.ts` (+ duplicado em PatchFile)
**Descrição:** Implementar algoritmo de diff baseado em LCS.

**Critério de pronto:**
- DP para Longest Common Subsequence
- Gera hunks no formato unified diff
- Guard: > 5000 linhas retorna summary
- Exportar como módulo shared (resolver DT1)

**Confiança:** 🟢

---

## Ordem de Implementação Sugerida

```
T-TL-02 (Path Safety) — fundação de segurança
  → T-TL-16 (LCS Diff) — shared utility
    → T-TL-03 (WriteFile)
    → T-TL-04 (PatchFile)
  → T-TL-05 (ReadFile)
  → T-TL-06 (ReadFolder)
  → T-TL-10 (Grep)
  → T-TL-11 (Glob)
→ T-TL-07 (Shell)
→ T-TL-08 (Git)
→ T-TL-09 (WebFetch)
→ T-TL-12 (SubAgent) — depende do Agent estar funcional
→ T-TL-13 (Todo)
→ T-TL-14 (Introspect)
→ T-TL-15 (UpdateKnowledge)
→ T-TL-01 (Registry) — finaliza com registro de todas
```

---

## Estimativa de Complexidade

| Task | Complexidade | LOC estimado |
|------|-------------|--------------|
| T-TL-01 | Baixa | ~30 |
| T-TL-02 | Média | ~80 |
| T-TL-03 | Média | ~70 |
| T-TL-04 | Média | ~60 |
| T-TL-05 | Baixa | ~30 |
| T-TL-06 | Baixa | ~25 |
| T-TL-07 | Média | ~90 |
| T-TL-08 | Baixa | ~50 |
| T-TL-09 | Alta | ~120 |
| T-TL-10 | Média | ~60 |
| T-TL-11 | Média | ~70 |
| T-TL-12 | Alta | ~100 |
| T-TL-13 | Baixa | ~40 |
| T-TL-14 | Baixa | ~20 |
| T-TL-15 | Baixa | ~25 |
| T-TL-16 | Média | ~80 |
| **Total** | — | **~950** |
