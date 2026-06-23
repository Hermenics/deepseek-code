# Design — Módulo State

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Componente Único: Store (`store.ts`) 🟢

**Pattern:** Pub/Sub simples (sem Redux, sem proxies).

**API:**
```ts
getState(): AppState
setState(partial: Partial<AppState>): void
subscribe(listener: (state: AppState) => void): () => void  // returns unsubscribe
resetState(): void
```

**AppState:**
```ts
interface AppState {
  sessionId: string
  provider: string
  model: string
  tokenCount: { input: number; output: number; cached: number }
  contextUsage: number
  contextLimit: number
  activeAgent: string | null
  isProcessing: boolean
}
```

**Implementação:**
```
let state: AppState = initialState
const listeners: Set<Function> = new Set()

setState(partial):
  state = { ...state, ...partial }
  listeners.forEach(fn => fn(state))

subscribe(fn):
  listeners.add(fn)
  return () => listeners.delete(fn)
```

---

## Decisões de Design

| Decisão | Rationale | Confiança |
|---------|-----------|-----------|
| Pub/sub simples (sem library) | Projeto single-component, overhead de Redux/Zustand desnecessário | 🟢 |
| Partial merge no setState | Conveniente: só passar campos que mudaram | 🟢 |
| Set para listeners | O(1) add/remove, sem duplicatas | 🟢 |
