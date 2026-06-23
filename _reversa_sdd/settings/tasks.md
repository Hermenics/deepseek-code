# Tasks — Módulo Settings

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

### T-ST-01: Settings Loader 🟢

**Fonte:** `src/settings/loader.ts`
**Descrição:** Implementar carregamento de 3 níveis com strip e merge.

**Critério de pronto:**
- Lê user (~/.deepseek/settings.json)
- Lê project ({cwd}/.deepseek/settings.json)
- Lê local ({cwd}/.deepseek/settings.local.json)
- Strip hooks de project e local
- Merge: arrays=concat+dedup, objects=shallow merge, scalars=override

**Confiança:** 🟢

---

### T-ST-02: Merge Function 🟢

**Fonte:** `src/settings/loader.ts` (merge logic)
**Descrição:** Implementar merge strategy com regras por tipo.

**Critério de pronto:**
- Detecta tipo do valor (array, object, scalar)
- Array: concat + dedup
- Object: spread 1 nível
- Scalar: último vence
- Null/undefined em override não sobrescreve

**Confiança:** 🟢

---

## Estimativa de Complexidade

| Task | Complexidade | LOC estimado |
|------|-------------|--------------|
| T-ST-01 | Média | ~60 |
| T-ST-02 | Baixa | ~30 |
| **Total** | — | **~90** |
