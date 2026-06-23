# Requirements — Módulo Tools

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Visão Geral

O módulo **Tools** implementa as 13 ferramentas executáveis pelo agente durante a conversação: operações de filesystem, shell, git, busca, sub-agente, web e utilidades.

**Caminho:** `src/tools/`

---

## Requisitos Funcionais

### RF-01: Interface Padronizada de Tool 🟢

**Prioridade:** Must
**Descrição:** Toda tool deve implementar a interface `{ name, description, parameters, execute(args): Promise<string> }`.

**Critérios de Aceitação:**
- Dado que uma tool é registrada, quando o LLM a chama, então `execute(args)` é invocado com os argumentos parseados
- Dado que `execute` retorna uma string, quando o agente processa, então a string é adicionada como tool result no histórico

### RF-02: WriteFile — Escrita com Diff 🟢

**Prioridade:** Must
**Descrição:** Escrever conteúdo completo em um arquivo, gerando diff LCS para exibição.

**Critérios de Aceitação:**
- Dado um path válido no sandbox, quando write_file executa, então o conteúdo é escrito no disco
- Dado que o arquivo já existe, quando a escrita ocorre, então um diff LCS é gerado e retornado
- Dado que o arquivo tem > 5000 linhas, quando diff é calculado, então retorna summary ao invés de diff completo
- Dado que o path viola sandbox, quando write_file é chamado, então retorna erro sem escrever

### RF-03: PatchFile — Replace Único 🟢

**Prioridade:** Must
**Descrição:** Substituir uma ocorrência exata de texto em um arquivo existente.

**Critérios de Aceitação:**
- Dado que `old_content` aparece exatamente 1 vez no arquivo, quando patch_file executa, então substitui por `new_content`
- Dado que `old_content` aparece 0 vezes, quando patch_file executa, então retorna erro "not found"
- Dado que `old_content` aparece > 1 vez, quando patch_file executa, então retorna erro "ambiguous match"
- Dado um patch bem-sucedido, quando o resultado é gerado, então um diff LCS é incluído

### RF-04: ReadFile — Leitura Segura 🟢

**Prioridade:** Must
**Descrição:** Ler conteúdo de um arquivo com validação de path.

**Critérios de Aceitação:**
- Dado um path dentro do sandbox, quando read_file executa, então retorna o conteúdo do arquivo
- Dado um path de arquivo sensível (.env, .pem), quando read_file é chamado, então retorna erro
- Dado um symlink que aponta para fora do sandbox, quando read_file resolve, então bloqueia via realpath

### RF-05: ReadFolder — Listagem de Diretório 🟢

**Prioridade:** Must
**Descrição:** Listar conteúdo de um diretório com metadados básicos.

**Critérios de Aceitação:**
- Dado um diretório válido, quando read_folder executa, então retorna lista de entries (nome, tipo, tamanho)
- Dado um path fora do sandbox, quando chamado, então retorna erro

### RF-06: Grep — Busca por Conteúdo 🟢

**Prioridade:** Must
**Descrição:** Buscar padrão em arquivos do projeto com limite de resultados.

**Critérios de Aceitação:**
- Dado um pattern e path, quando grep executa, então retorna matches com arquivo:linha:conteúdo
- Dado que resultados excedem 200 linhas, quando processados, então são truncados com aviso
- Dado que o pattern é aplicado, quando path safety valida, então paths fora do sandbox são ignorados

### RF-07: Glob — Busca por Nome de Arquivo 🟢

**Prioridade:** Must
**Descrição:** Encontrar arquivos por glob pattern com proteções anti-ReDoS.

**Critérios de Aceitação:**
- Dado um pattern glob válido, quando glob executa, então retorna lista de paths matching
- Dado que resultados excedem 500 arquivos, quando processados, então são truncados
- Dado que o pattern está na lista BLOCKED_GLOB_PATTERNS, quando glob é chamado, então retorna erro

### RF-08: Shell — Execução de Comandos 🟢

**Prioridade:** Must
**Descrição:** Executar comandos shell com detecção de operações destrutivas.

**Critérios de Aceitação:**
- Dado um comando não-destrutivo, quando shell executa, então retorna stdout+stderr
- Dado um comando destrutivo (rm -rf, git reset --hard, mkfs, dd), quando detectado, então requer confirmação do usuário
- Dado que output excede 50k chars, quando processado, então é truncado
- Dado que execução excede 30s, quando timeout dispara, então o processo é morto

### RF-09: Git — Operações VCS 🟢

**Prioridade:** Must
**Descrição:** Executar operações git com proteções de segurança.

**Critérios de Aceitação:**
- Dado um comando git válido, quando git executa, então retorna output via execa
- Dado que o comando é push, quando força é necessária, então usa `--force-with-lease` (nunca `--force`)
- Dado que o comando é destrutivo (reset --hard), quando detectado, então requer confirmação

### RF-10: WebFetch — HTTP com SSRF Protection 🟢

**Prioridade:** Must
**Descrição:** Fazer requisições HTTP com bloqueio de endereços internos.

**Critérios de Aceitação:**
- Dado uma URL pública válida, quando web_fetch executa, então retorna conteúdo (HTML stripped para texto)
- Dado uma URL para localhost/127.0.0.1, quando validada, então é bloqueada
- Dado uma URL para IP privado (10.x, 172.16-31.x, 192.168.x), quando validada, então é bloqueada
- Dado uma URL para metadata endpoint (169.254.169.254), quando validada, então é bloqueada

### RF-11: SubAgent — Loop Independente 🟢

**Prioridade:** Should
**Descrição:** Spawnar instância independente do agente para subtarefas focadas.

**Critérios de Aceitação:**
- Dado uma tarefa delegada, quando subagent spawna, então herda provider e permissions do parent
- Dado que subagent atinge 15 iterações, quando o limite é atingido, então é abortado com resultado parcial
- Dado que subagent completa, quando o resultado é retornado, então é adicionado ao histórico do parent

### RF-12: Todo — Gerenciamento de Tarefas 🟢

**Prioridade:** Should
**Descrição:** CRUD de todo items para tracking de progresso durante a conversa.

**Critérios de Aceitação:**
- Dado operação create, quando todo executa, então adiciona item com status "pending"
- Dado operação update com novo status, quando executa, então muda para "in_progress" ou "done"
- Dado operação list, quando executa, então retorna todos os items com status atual

### RF-13: Introspect — Meta-informação 🟢

**Prioridade:** Could
**Descrição:** Retornar informações sobre o próprio agente (model, provider, context usage).

**Critérios de Aceitação:**
- Dado chamada introspect, quando executa, então retorna model, provider, tokenCount, contextUsage/Limit

### RF-14: UpdateKnowledge — Persistência de Conhecimento 🟢

**Prioridade:** Could
**Descrição:** Atualizar arquivos de steering/knowledge base persistidos.

**Critérios de Aceitação:**
- Dado conteúdo e path válido em `.deepseek/`, quando executa, então o arquivo é atualizado

---

## Requisitos Não Funcionais

| # | Categoria | Requisito | Confiança |
|---|-----------|-----------|-----------|
| RNF-01 | Segurança | Path sandbox: todos os paths devem estar dentro do cwd | 🟢 |
| RNF-02 | Segurança | Symlink traversal bloqueado via realpath | 🟢 |
| RNF-03 | Segurança | Arquivos sensíveis (.env, .pem, credentials, SSH keys) inacessíveis | 🟢 |
| RNF-04 | Segurança | Diretórios internos (.deepseek, .git, node_modules) off-limits | 🟢 |
| RNF-05 | Segurança | SSRF protection para WebFetch (private IPs, metadata endpoints) | 🟢 |
| RNF-06 | Segurança | Shell: detecção de comandos destrutivos | 🟢 |
| RNF-07 | Segurança | Glob: anti-ReDoS (iterativo, max 10 wildcards) | 🟢 |
| RNF-08 | Performance | Shell output max 50k chars | 🟢 |
| RNF-09 | Performance | Shell timeout 30s | 🟢 |
| RNF-10 | Performance | Grep max 200 linhas | 🟢 |
| RNF-11 | Performance | Glob max 500 arquivos | 🟢 |
| RNF-12 | Performance | Diff LCS guard: > 5000 linhas retorna summary | 🟢 |

---

## MoSCoW Summary

| Prioridade | Requisitos |
|------------|------------|
| **Must** | RF-01 a RF-10 (interface, write, patch, read, folder, grep, glob, shell, git, webfetch) |
| **Should** | RF-11, RF-12 (subagent, todo) |
| **Could** | RF-13, RF-14 (introspect, update_knowledge) |
| **Won't** | N/A |

---

## Dependências

| Depende de | Motivo |
|------------|--------|
| `agent` | Invocação via checkAndExecuteTool |
| `permissions` | Validação de acesso pré-execução |
| `constants/tools` | Limites (timeout, max chars, max lines) |
| `state` | Todo items armazenados no state store |
