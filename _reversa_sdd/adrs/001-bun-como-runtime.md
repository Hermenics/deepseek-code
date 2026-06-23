# ADR-001: Bun como Runtime Principal

> Status: Aceito
> Data: 2026 (inferido do histórico)
> Contexto: commit `77e4c7b` — "feat(build): migrate to bun runtime and add shell wrapper for process naming"
> Reforçado por revert `300b47e` — "restore --target bun (node target breaks Ink raw mode)"

## Decisão

Usar Bun como runtime principal em vez de Node.js.

## Razão

- Node target causa falha no Ink com "Raw mode is not supported" porque as APIs específicas do Bun para stdin raw mode não estão disponíveis no target Node.js.
- Bun oferece bundling nativo, test runner integrado e startup mais rápido.
- O shebang permanece `#!/usr/bin/env node` (cosmético), mas a execução real é via Bun.

## Consequências

- CI fixado em Bun 1.3.13 para reprodutibilidade.
- `bun.lock` é o lockfile autoritativo (package-lock.json mantido por compatibilidade).
- Aliases em `bunfig.toml` substituem dependências em dev (react-devtools-core stubado).
- Testes rodam via `bun test` (Vitest como framework, Bun como runner).

🟢 CONFIRMADO
