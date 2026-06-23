# Requirements — Módulo Settings

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Visão Geral

O módulo **Settings** implementa o carregamento hierárquico de configurações com merge strategy definida.

**Caminho:** `src/settings/`

---

## Requisitos Funcionais

### RF-01: Carregamento Hierárquico 🟢

**Prioridade:** Must
**Descrição:** Carregar settings de 3 níveis com precedência crescente.

**Critérios de Aceitação:**
- Dado `~/.deepseek/settings.json` (user), quando carregado, então é a base
- Dado `.deepseek/settings.json` (project), quando carregado, então sobrescreve user
- Dado `.deepseek/settings.local.json` (local), quando carregado, então sobrescreve project
- Dado que um nível não existe, quando carregado, então é ignorado silenciosamente

### RF-02: Merge Strategy 🟢

**Prioridade:** Must
**Descrição:** Merge com regras específicas por tipo de valor.

**Critérios de Aceitação:**
- Arrays: concat + dedup (ex: allow rules de ambos os níveis)
- Objects: deep merge (1 nível de profundidade)
- Scalars: higher priority wins

### RF-03: Security Strip de Hooks 🟢

**Prioridade:** Must
**Descrição:** Hooks de project e local levels são removidos antes do merge.

**Critérios de Aceitação:**
- Dado hooks em project settings, quando loaded, então campo `hooks` é removido
- Dado hooks em local settings, quando loaded, então campo `hooks` é removido
- Dado hooks em user settings, quando loaded, então são preservados

### RF-04: Schema Settings 🟢

**Prioridade:** Must
**Descrição:** Settings suportam os campos configuráveis do sistema.

**Critérios de Aceitação:**
- `model`: override do modelo LLM
- `provider`: override do provider
- `theme`: tema visual
- `language`: idioma da interface
- `autoCompact`: boolean ativa/desativa
- `autoCompactThreshold`: 0.0-1.0
- `allow`: array de permission rules
- `deny`: array de permission rules
- `hooks`: objeto com PreToolUse/PostToolUse/SessionStart
- `mcp`: configuração de servidores MCP

---

## Dependências

| Depende de | Motivo |
|------------|--------|
| `utils/fs` | readJson para cada nível |
| `constants` | CONFIG_DIR (".deepseek") |
