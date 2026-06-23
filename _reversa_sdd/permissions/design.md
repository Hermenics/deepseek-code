# Design — Módulo Permissions

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Componentes

### 1. Resolver (`resolver.ts`) 🟢

**Fluxo de resolução:**
```
resolvePermission(toolName, args, rules):
  1. Extrai content para match baseado na tool (command, path, url, pattern)
  2. Checa deny rules:
     - Se alguma deny rule match → return DENIED
  3. Checa allow rules:
     - Se alguma allow rule match → return ALLOWED
     - Se allow rules existem mas nenhuma match → return ASK
  4. Se nenhuma rule existe → return ASK
```

### 2. Matcher (`matcher.ts`) 🟢

**Algoritmo iterativo (anti-ReDoS):**
```
iterativeGlob(pattern, text):
  - Dois ponteiros: patIdx, textIdx
  - Quando encontra '*': salva posição de backtrack
  - Avança text pointer até achar match ou esgotar
  - Complexidade: O(n*m) no pior caso
  - Limite: rejeita patterns com > 10 wildcards
  - Case-insensitive: lowercase ambos antes de comparar
```

### 3. Parser (`parser.ts`) 🟢

**Parsing de rule string:**
```
parseRule("Shell(git *)")
  → { toolName: "shell", pattern: "git *" }

parseRule("WriteFile(src/**/*.ts)")
  → { toolName: "write_file", pattern: "src/**/*.ts" }

parseRule("*")
  → { toolName: "*", pattern: "*" }
```

---

## Decisões de Design

| Decisão | Rationale | Confiança |
|---------|-----------|-----------|
| Deny-first | Segurança: explicitamente bloquear tem precedência | 🟢 |
| Iterativo (não regex) | Imune a ReDoS: sem backtracking exponencial | 🟢 |
| 10 wildcards max | Limita complexidade mesmo do algoritmo iterativo | 🟢 |
| ASK como fallback | Na dúvida, pergunta ao usuário ao invés de bloquear ou permitir | 🟢 |
