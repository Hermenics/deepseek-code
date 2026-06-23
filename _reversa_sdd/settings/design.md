# Design — Módulo Settings

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Componentes

### Loader (`loader.ts`) 🟢

**Fluxo `loadMergedSettings(cwd)`:**
```
1. userSettings = readJson("~/.deepseek/settings.json") || {}
2. projectSettings = readJson("{cwd}/.deepseek/settings.json") || {}
3. localSettings = readJson("{cwd}/.deepseek/settings.local.json") || {}
4. Strip hooks de projectSettings e localSettings
5. Merge:
   result = merge(userSettings, projectSettings, localSettings)
6. return result
```

**Merge rules:**
```
merge(base, ...overrides):
  para cada override:
    para cada key:
      se valor é array → concat + dedup com base[key]
      se valor é object → {...base[key], ...override[key]} (1 nível)
      se valor é scalar → override vence
```

---

## Decisões de Design

| Decisão | Rationale | Confiança |
|---------|-----------|-----------|
| 3 níveis (user/project/local) | User = defaults globais, Project = team-shared, Local = personal overrides (gitignored) | 🟢 |
| Arrays concat+dedup | Permite project adicionar rules sem perder as do user | 🟢 |
| Deep merge 1 nível | Evita complexidade de merge recursivo infinito | 🟢 |
| Hooks only user-level | Segurança: previne execução de código de repos maliciosos | 🟢 |
| .local.json gitignored | Permite config pessoal sem afetar team | 🟡 |
