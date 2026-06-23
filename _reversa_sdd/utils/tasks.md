# Tasks — Módulo Utils

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

### T-UT-01: Filesystem Helpers 🟢

**Fonte:** `src/utils/fs.ts`
**Descrição:** readJson, writeJson, writeRaw, globFiles.

**Critério de pronto:**
- readJson: lê + parse, null se inexistente
- writeJson: serialize + write pretty
- writeRaw: write string
- globFiles: pattern matching de paths

**Confiança:** 🟢

---

### T-UT-02: Semver 🟢

**Fonte:** `src/utils/semver.ts`
**Descrição:** Parse e comparação de versões semânticas.

**Critério de pronto:**
- Parse: major.minor.patch(-prerelease)
- compare(a,b): -1, 0, 1
- isNewer(remote, local): boolean

**Confiança:** 🟢

---

### T-UT-03: Auto-Update 🟢

**Fonte:** `src/utils/auto-update.ts`
**Descrição:** Check npm registry para versão mais recente.

**Critério de pronto:**
- Fetch https://registry.npmjs.org/{package}/latest
- Extrai version, compara com local
- Retorna { available: boolean, latest: string }
- Timeout: 3s (não bloqueia startup)

**Confiança:** 🟢

---

### T-UT-04: SliceAnsi 🟢

**Fonte:** `src/utils/sliceAnsi.ts`
**Descrição:** Slice de strings com ANSI codes.

**Critério de pronto:**
- Conta apenas caracteres visíveis para posição
- Preserva ANSI codes ativos no ponto de corte
- Insere reset no final se necessário

**Confiança:** 🟢

---

### T-UT-05: Demais Utils 🟢

**Fonte:** `src/utils/` (credentials, env, debug, chatError, intl, fullscreen, earlyInput, ink-shims)
**Descrição:** Implementar utilitários restantes.

**Critério de pronto:**
- Cada um funcional conforme interface descrita no design

**Confiança:** 🟢

---

## Estimativa de Complexidade

| Task | Complexidade | LOC estimado |
|------|-------------|--------------|
| T-UT-01 | Baixa | ~40 |
| T-UT-02 | Baixa | ~30 |
| T-UT-03 | Baixa | ~35 |
| T-UT-04 | Média | ~60 |
| T-UT-05 | Média | ~120 |
| **Total** | — | **~285** |
