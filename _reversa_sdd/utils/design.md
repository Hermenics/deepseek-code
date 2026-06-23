# Design — Módulo Utils

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Catálogo de Utilitários

| Arquivo | API | Função |
|---------|-----|--------|
| `fs.ts` | readJson, writeJson, writeRaw, globFiles | Filesystem JSON helpers |
| `credentials.ts` | logout(), migrate() | Gestão de credenciais |
| `env.ts` | getEnv(key), isCI() | Helpers para variáveis de ambiente |
| `debug.ts` | debug(msg) | Log condicional (DEBUG env) |
| `semver.ts` | compare(a,b), isNewer(a,b) | Comparação semântica de versões |
| `auto-update.ts` | checkUpdate() | Fetch npm registry, compara versão |
| `chatError.ts` | formatApiError(err) | Formata erros HTTP da API para display |
| `sliceAnsi.ts` | sliceAnsi(str, start, end) | Slice preservando ANSI escapes |
| `intl.ts` | t(key), setLocale(lang) | Internacionalização |
| `fullscreen.ts` | enterFullscreen(), exitFullscreen() | Alternate screen buffer |
| `earlyInput.ts` | captureEarly(), flush(target) | Buffer pre-mount keystrokes |
| `ink-shims.ts` | shimInkApis() | Compatibilidade com Ink fork |

---

## Decisões de Design

| Decisão | Rationale | Confiança |
|---------|-----------|-----------|
| Módulo flat (sem subpastas) | Utilitários simples, não justificam hierarquia | 🟢 |
| readJson retorna null (não throws) | Caller decide o que fazer com ausência | 🟢 |
| Auto-update só informa (não instala) | Evita side-effects surpresa durante sessão | 🟢 |
| Early input buffer | Bun + React mount tem delay; sem buffer, keystrokes iniciais se perdem | 🟢 |
