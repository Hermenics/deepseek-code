# Requirements — Módulo Utils

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Visão Geral

O módulo **Utils** agrupa utilitários compartilhados: filesystem helpers, credentials, env, debug, semver, auto-update, ANSI slice, i18n, fullscreen e early input.

**Caminho:** `src/utils/`

---

## Requisitos Funcionais

### RF-01: Filesystem Helpers (`fs.ts`) 🟢

**Prioridade:** Must
**Descrição:** readJson, writeJson, writeRaw, globFiles.

**Critérios de Aceitação:**
- `readJson(path)`: lê e parse JSON, retorna null se não existe
- `writeJson(path, data)`: serializa e escreve (pretty-printed)
- `writeRaw(path, content)`: escreve string raw
- `globFiles(pattern, cwd)`: retorna array de paths matching

### RF-02: Credentials (`credentials.ts`) 🟢

**Prioridade:** Must
**Descrição:** Migração de config legado e logout (limpa ~/.deepseek/).

**Critérios de Aceitação:**
- `logout()`: remove credentials de `~/.deepseek/`
- Migração: detecta config antigo e converte para formato atual

### RF-03: Auto-Update (`auto-update.ts`) 🟢

**Prioridade:** Should
**Descrição:** Verifica npm registry para atualizações.

**Critérios de Aceitação:**
- Fetch latest version do npm registry
- Compara com versão local via semver
- Retorna info se update disponível (não instala automaticamente)

### RF-04: Semver (`semver.ts`) 🟢

**Prioridade:** Must
**Descrição:** Comparação de versões semânticas.

**Critérios de Aceitação:**
- `compare(a, b)`: retorna -1, 0, 1
- `isNewer(remote, local)`: boolean
- Parse: major.minor.patch(-prerelease)

### RF-05: SliceAnsi (`sliceAnsi.ts`) 🟢

**Prioridade:** Should
**Descrição:** Slice de strings preservando códigos ANSI.

**Critérios de Aceitação:**
- `sliceAnsi(str, start, end)`: retorna substring com ANSI codes preservados
- Reset codes inseridos corretamente nos pontos de corte

### RF-06: Internacionalização (`intl.ts`) 🟢

**Prioridade:** Could
**Descrição:** Helpers para mensagens internacionalizadas.

### RF-07: Debug (`debug.ts`) 🟢

**Prioridade:** Should
**Descrição:** Logging condicional ativado por env var.

**Critérios de Aceitação:**
- `debug(msg)`: loga apenas se `DEBUG=true` ou `DEEPSEEK_DEBUG=true`

### RF-08: Early Input (`earlyInput.ts`) 🟢

**Prioridade:** Should
**Descrição:** Captura input do usuário antes do React montar.

**Critérios de Aceitação:**
- Buffer de keystrokes recebidos antes do render
- Flush para InputBox quando componente monta

---

## Dependências

Nenhuma dependência interna (módulo leaf).
