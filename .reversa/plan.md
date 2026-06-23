# Plano de Exploração — deepseek-code

> Criado pelo Reversa em 2026-06-23
> Marque cada tarefa com ✅ quando concluída.
> Você pode editar este plano antes de iniciar: adicione, remova ou reordene tarefas conforme necessário.

---

## Fase 1: Reconhecimento 🔍

- [x] ✅ **Scout** — Mapeamento de estrutura de pastas e tecnologias
- [x] ✅ **Scout** — Análise de dependências e gerenciadores de pacotes
- [x] ✅ **Scout** — Identificação de entry points, CI/CD e configurações

## Decisão de organização das specs 🗂️

> Entre o Scout e o Arqueólogo, o Reversa pergunta como você quer organizar as specs (por módulo, caso de uso, endpoint, híbrida, por features ou customizada). A escolha fica persistida em `.reversa/config.toml` na seção `[specs]` e não será reperguntada em execuções futuras. Para reapresentar o menu, remova manualmente a seção.

## Fase 2: Escavação 🏗️

> Módulos identificados pelo Scout — análise detalhada por módulo.

- [x] ✅ **Arqueólogo** — Análise do módulo `agent` (core LLM loop, providers, MCP)
- [x] ✅ **Arqueólogo** — Análise do módulo `tools` (13 ferramentas do agente)
- [x] ✅ **Arqueólogo** — Análise do módulo `commands` (22 slash commands)
- [x] ✅ **Arqueólogo** — Análise do módulo `ink` (fork do Ink — React TUI renderer)
- [x] ✅ **Arqueólogo** — Análise do módulo `ui` (componentes de aplicação, input, messages)
- [x] ✅ **Arqueólogo** — Análise do módulo `hooks` (sistema de hooks extensível)
- [x] ✅ **Arqueólogo** — Análise do módulo `permissions` (allow/deny patterns)
- [x] ✅ **Arqueólogo** — Análise do módulo `settings` (loader hierárquico)
- [x] ✅ **Arqueólogo** — Análise do módulo `services` (compact, MCP, session)
- [x] ✅ **Arqueólogo** — Análise do módulo `state` (store + selectors)
- [x] ✅ **Arqueólogo** — Análise do módulo `utils` (credentials, fs, env, debug)
- [x] ✅ **Arqueólogo** — Análise do módulo `constants` (product, tools, UI)

## Fase 3: Interpretação 🧠

- [x] ✅ **Detetive** — Arqueologia Git e ADRs retroativos
- [x] ✅ **Detetive** — Regras de negócio implícitas e máquinas de estado
- [x] ✅ **Detetive** — Matriz de permissões (RBAC/ACL)
- [x] ✅ **Arquiteto** — Diagramas C4 (Contexto, Containers, Componentes)
- [x] ✅ **Arquiteto** — ERD completo e integrações externas
- [x] ✅ **Arquiteto** — Spec Impact Matrix

## Fase 4: Geração 📝

- [x] ✅ **Redator** — Specs SDD por componente (12 módulos: 3 arquivos canônicos + opcionais)
- [ ] **Redator** — OpenAPI (não aplicável — projeto não expõe API pública)
- [x] ✅ **Redator** — User Stories (13 user stories em fluxos-principais.md)
- [x] ✅ **Redator** — Code/Spec Matrix (traceability/code-spec-matrix.md — 92% cobertura)

## Fase 5: Revisão ✅

- [x] ✅ **Revisor** — Revisão cruzada de specs
- [x] ✅ **Revisor** — Resolução de lacunas com o usuário
- [x] ✅ **Revisor** — Relatório de confiança final

---

## Agentes Independentes

> Execute estes agentes quando os recursos estiverem disponíveis — podem rodar em qualquer fase.

- [ ] **Visor** — Análise de interface via screenshots
- [ ] **Data Master** — Análise completa do banco de dados
- [ ] **Design System** — Extração de tokens de design
- [ ] **Tracer** — Análise dinâmica (requer sistema acessível)

---

## Próximo passo

Após o Time de Descoberta concluir e o `_reversa_sdd/` estar populado, você pode disparar um dos fluxos seguintes:

- `/reversa-migrate`: orquestrador do **Time de Migração** (Paradigm Advisor → Curator → Strategist → Designer → Screen Translator → Inspector). Gera as specs do sistema novo. Saída em `_reversa_sdd/migration/` e `_reversa_sdd/screens/`.
- `/reversa-reconstructor`: gera plano bottom-up para reimplementar o software a partir das specs do legado (uma tarefa por sessão).
