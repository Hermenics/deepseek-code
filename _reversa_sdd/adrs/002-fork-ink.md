# ADR-002: Fork Customizado do Ink

> Status: Aceito
> Data: 2026 (inferido do histórico)
> Contexto: commit `8b59345` — "feat(ui,ink): migrate to custom ink renderer and refactor UI architecture"

## Decisão

Forkar o Ink (React TUI renderer) diretamente no codebase em vez de usar como dependência npm.

## Razão

- Necessidade de controle total sobre o rendering pipeline para features avançadas (mouse tracking, hit testing, custom events).
- Yoga layout bindings reimplementados em TypeScript puro (sem native addon).
- Event system customizado (click, paste, terminal focus) não disponível no Ink upstream.
- Otimizações específicas: log-update inteligente que só re-renderiza linhas alteradas.

## Consequências

- ~130 arquivos adicionais em `src/ink/` mantidos pelo projeto.
- Sem atualizações automáticas do Ink upstream.
- Yoga layout via TS puro (sem dependência nativa = portabilidade total).
- React 19 + react-reconciler 0.33 como dependências diretas.

🟢 CONFIRMADO
