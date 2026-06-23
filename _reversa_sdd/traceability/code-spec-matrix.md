# Code-Spec Matrix — deepseek-code

> Gerado pelo Redator (Reversa) em 2026-06-23
> Mapeia cada arquivo/pasta do legado à unit que o cobre na documentação.

## Legenda

- 🟢 Coberto — arquivo documentado em detail no spec da unit
- 🟡 Parcial — funcionalidade coberta mas sem spec dedicado
- n/a — Não mapeado a nenhuma unit (infraestrutura, config, ou fork externo)

---

## Mapeamento

| Arquivo / Pasta | Unit | Cobertura |
|-----------------|------|-----------|
| `src/agent/agent.ts` | `agent/` | 🟢 |
| `src/agent/llmClient.ts` | `agent/` | 🟢 |
| `src/agent/steering.ts` | `agent/` | 🟢 |
| `src/agent/session.ts` | `agent/` | 🟢 |
| `src/agent/checkpoint.ts` | `agent/` | 🟢 |
| `src/agent/compactBoundary.ts` | `agent/` | 🟢 |
| `src/agent/auditLog.ts` | `agent/` | 🟢 |
| `src/agent/cost.ts` | `agent/` | 🟢 |
| `src/agent/config.ts` | `agent/` | 🟢 |
| `src/agent/mcp.ts` | `agent/` | 🟢 |
| `src/agent/history.ts` | `agent/` | 🟡 |
| `src/agent/providers/bedrock.ts` | `agent/` | 🟢 |
| `src/agent/providers/vertex.ts` | `agent/` | 🟢 |
| `src/agent/providers/proxy/` | `agent/` | 🟢 |
| `src/tools/WriteFile/` | `tools/` | 🟢 |
| `src/tools/PatchFile/` | `tools/` | 🟢 |
| `src/tools/ReadFile/` | `tools/` | 🟢 |
| `src/tools/ReadFolder/` | `tools/` | 🟢 |
| `src/tools/Shell/` | `tools/` | 🟢 |
| `src/tools/Git/` | `tools/` | 🟢 |
| `src/tools/Grep/` | `tools/` | 🟢 |
| `src/tools/Glob/` | `tools/` | 🟢 |
| `src/tools/WebFetch/` | `tools/` | 🟢 |
| `src/tools/SubAgent/` | `tools/` | 🟢 |
| `src/tools/Todo/` | `tools/` | 🟢 |
| `src/tools/Introspect/` | `tools/` | 🟢 |
| `src/tools/UpdateKnowledge/` | `tools/` | 🟢 |
| `src/tools/shared/pathSafety.ts` | `tools/` | 🟢 |
| `src/commands/*/index.ts` | `commands/` | 🟢 |
| `src/ui/App.tsx` | `ui/` | 🟢 |
| `src/ui/input/InputBox.tsx` | `ui/` | 🟢 |
| `src/ui/input/vim/` | `ui/` | 🟢 |
| `src/ui/messages/` | `ui/` | 🟢 |
| `src/ui/StatusBar.tsx` | `ui/` | 🟢 |
| `src/ui/interactionMode.ts` | `ui/` | 🟢 |
| `src/ui/setup/` | `ui/` | 🟢 |
| `src/ink/reconciler.ts` | `ink/` | 🟢 |
| `src/ink/renderer.ts` | `ink/` | 🟢 |
| `src/ink/components/` | `ink/` | 🟢 |
| `src/ink/events/` | `ink/` | 🟢 |
| `src/ink/termio/` | `ink/` | 🟢 |
| `src/ink/native-ts/yoga-layout/` | `ink/` | 🟢 |
| `src/hooks/` | `hooks/` | 🟢 |
| `src/permissions/` | `permissions/` | 🟢 |
| `src/settings/loader.ts` | `settings/` | 🟢 |
| `src/services/compact/` | `services/` | 🟢 |
| `src/state/store.ts` | `state/` | 🟢 |
| `src/utils/*.ts` | `utils/` | 🟢 |
| `src/constants/*.ts` | `constants/` | 🟢 |
| `src/index.tsx` | n/a | n/a |
| `src/entrypoints/cli.tsx` | n/a | n/a |
| `src/entrypoints/pipe.ts` | n/a | n/a |
| `src/types/` | n/a | n/a |
| `build.ts` | n/a | n/a |
| `tests/` | n/a | n/a |
| `.github/` | n/a | n/a |
| `package.json` | n/a | n/a |

---

## Estatísticas de Cobertura

| Métrica | Valor |
|---------|-------|
| Arquivos/pastas mapeados a units | ~50 |
| Arquivos com cobertura 🟢 | ~47 |
| Arquivos com cobertura 🟡 | ~1 |
| Arquivos n/a (infra, config, types, tests) | ~8 |
| **Cobertura estimada** | **~92%** |

---

## Candidatos a Análise Adicional

| Arquivo | Motivo |
|---------|--------|
| `src/index.tsx` | Entry point — conecta CLI args ao React render. Simples, não justifica unit própria. |
| `src/entrypoints/cli.tsx` | Arg parsing e session resume. Poderia ser documentado como sub-task de `agent/`. |
| `src/entrypoints/pipe.ts` | Pipe mode (stdin → agent → stdout). Funcionalidade secondary. |
| `src/types/` | Tipos TypeScript — documentados no data-dictionary. |
