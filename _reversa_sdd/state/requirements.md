# Requirements — Módulo State

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Visão Geral

O módulo **State** implementa state management centralizado via pub/sub simples.

**Caminho:** `src/state/`

---

## Requisitos Funcionais

### RF-01: Store Pub/Sub 🟢

**Prioridade:** Must
**Descrição:** Store centralizado com getState, setState, subscribe e resetState.

**Critérios de Aceitação:**
- Dado `setState(partial)`, quando chamado, então state é mergeado e listeners notificados
- Dado `subscribe(listener)`, quando state muda, então listener é chamado com novo state
- Dado `resetState()`, quando chamado, então state volta ao initial e listeners notificados

### RF-02: AppState Shape 🟢

**Prioridade:** Must
**Descrição:** State contém campos essenciais da aplicação.

**Critérios de Aceitação:**
- Campos: sessionId, provider, model, tokenCount, contextUsage, contextLimit, activeAgent, isProcessing

---

## Dependências

Nenhuma (módulo leaf — não depende de outros módulos internos).
