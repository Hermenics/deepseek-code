# 🔗 PROTOCOLO DE COMUNICAÇÃO INTER-AGENT

> Este documento é a **lei fundamental** do sistema multi-agente do DeepSeek Code.
> Todo agent DEVE ler este arquivo antes de qualquer ação.

---

## 1. MODELO DE DECISÃO COLABORATIVA

### 1.1 Princípio: Nenhum Agent Decide Sozinho

Decisões arquiteturais, de design ou que impactam mais de um módulo **DEVEM** passar por consenso:

```
CEO propõe → Agents relevantes opinam → CEO decide com base nas opiniões
```

### 1.2 Protocolo de Consulta Rápida

Quando um agent precisa de input de outro:

```markdown
## 📡 CONSULTA: [agent_destino]
**De:** [agent_origem]
**Sobre:** [tema em 1 linha]
**Contexto:** [2-3 linhas de contexto]
**Pergunta:** [pergunta específica]
**Impacto se ignorado:** [consequência]
```

### 1.3 Protocolo de Veto

Qualquer agent pode vetar uma decisão se identificar:
- 🔴 Risco de segurança
- 🔴 Quebra de testes existentes
- 🔴 Violação de arquitetura estabelecida
- 🔴 Regressão de performance > 20%

Formato de veto:
```markdown
## 🚫 VETO: [motivo em 1 linha]
**Agent:** [quem veta]
**Evidência:** [prova concreta — log, teste, benchmark]
**Alternativa proposta:** [solução que resolve o veto]
```

---

## 2. FORMATO DE MENSAGEM INTER-AGENT (OBRIGATÓRIO)

### 2.1 Delegação de Tarefa (CEO → Agent)

```markdown
## 🎯 TASK: [ID]-[nome-curto]

### Contexto
[O que está sendo feito, por quê, e como se encaixa no todo]

### Pré-condições
- [x] [dependência já satisfeita]
- [ ] [dependência pendente — quem resolve]

### Escopo Exato
**Criar:** [arquivos novos]
**Modificar:** [arquivos existentes]
**NÃO tocar:** [arquivos fora do escopo]

### Contrato de Entrada
[Interfaces/tipos que o código deve respeitar]

### Contrato de Saída
[O que deve ser verdade quando a tarefa terminar]

### Critérios de Aceitação
- [ ] [critério verificável 1]
- [ ] [critério verificável 2]

### Testes Esperados (do Tester)
- [ ] [cenário de teste 1]
- [ ] [cenário de teste 2]

### Deadline de Qualidade
- `bun test` 100% verde
- Zero `any` sem justificativa
- Zero warnings do TypeScript
```

### 2.2 Relatório de Conclusão (Agent → CEO)

```markdown
## ✅ DONE: [ID]-[nome-curto]

### Resultado
[1-2 frases sobre o que foi feito]

### Arquivos Tocados
- `path/file.ts` — [o que mudou]

### Decisões Tomadas
- [decisão 1]: [justificativa]

### Riscos Identificados
- [risco]: [mitigação sugerida]

### Status dos Testes
- Total: X | Passando: X | Falhando: 0

### Próximo Passo Sugerido
[O que o próximo agent deve fazer]
```

### 2.3 Relatório de Bloqueio (Agent → CEO)

```markdown
## 🚨 BLOCKED: [ID]-[nome-curto]

### Problema
[Descrição precisa do bloqueio]

### Já Tentei
1. [abordagem 1] → [resultado]
2. [abordagem 2] → [resultado]

### Preciso De
- [ ] [recurso/decisão/informação necessária]
- [ ] [agent que pode desbloquear: @agent_name]

### Impacto do Bloqueio
[O que não avança enquanto isso não for resolvido]
```

---

## 3. PROTOCOLO TDD UNIFICADO

### 3.1 Fluxo TDD Obrigatório (Todos os Agents)

```
┌─────────────────────────────────────────────────────────┐
│  CEO: Define contratos + critérios de aceitação         │
│    ↓                                                     │
│  TESTER: Escreve testes (RED) → confirma que falham     │
│    ↓                                                     │
│  CODER/DESIGNER: Implementa mínimo para GREEN          │
│    ↓                                                     │
│  TESTER: Valida GREEN + adiciona edge cases             │
│    ↓                                                     │
│  REVIEWER: Analisa qualidade + segurança                │
│    ↓                                                     │
│  CEO: Confirma gates + entrega                          │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Regra de Ouro do TDD

> **Se não tem teste, não existe. Se o teste não falhou primeiro, não é TDD.**

### 3.3 Contrato de Teste (Tester → Coder)

O Tester DEVE entregar ao Coder:
1. Arquivo de teste completo e executável
2. Lista de `it()` blocks com comportamento esperado
3. Mocks necessários já configurados
4. Comando exato para rodar: `bun test tests/[arquivo].test.ts`

### 3.4 Validação Cruzada

Após implementação, o Tester DEVE:
1. Rodar `bun test` e confirmar 100% verde
2. Adicionar pelo menos 2 edge cases não previstos
3. Verificar que remover o código faz os testes falharem (prova de cobertura real)

---

## 4. PROTOCOLO DE RESOLUÇÃO DE ERROS EM PROMPT ÚNICO

### 4.1 Filosofia: Zero Loops de Erro

> Um erro DEVE ser resolvido completamente na primeira tentativa de correção.
> Isso exige: diagnóstico profundo ANTES de agir.

### 4.2 Protocolo de Diagnóstico (OBRIGATÓRIO antes de corrigir)

```markdown
## 🔍 DIAGNÓSTICO: [erro em 1 linha]

### 1. Sintoma
[O que está acontecendo — mensagem de erro exata]

### 2. Localização
[Arquivo:linha exata onde o erro se manifesta]

### 3. Causa Raiz (NÃO o sintoma)
[Por que isso acontece — trace completo]

### 4. Impacto
[Outros módulos/testes afetados]

### 5. Fix Proposto
[Mudança exata — com diff mental]

### 6. Efeitos Colaterais do Fix
[O que mais pode quebrar com essa mudança]

### 7. Testes que Validam o Fix
[Quais testes devem passar após o fix]
```

### 4.3 Regra Anti-Loop

```
SE erro persiste após 1 tentativa de fix:
  → PARE imediatamente
  → Refaça o diagnóstico do zero (a causa raiz estava errada)
  → Considere abordagem completamente diferente
  → NUNCA aplique o mesmo fix com variação mínima

SE erro persiste após 2 tentativas:
  → Escale para o CEO com relatório completo
  → CEO convoca reunião multi-agent para decisão colaborativa
```

### 4.4 Reunião de Emergência Multi-Agent

Quando um erro resiste a 2 tentativas:

```markdown
## 🆘 REUNIÃO DE EMERGÊNCIA

### Problema
[Descrição completa]

### Histórico de Tentativas
1. [tentativa 1] → [por que falhou]
2. [tentativa 2] → [por que falhou]

### Análise por Agent
- **Coder:** [perspectiva de implementação]
- **Tester:** [perspectiva de cobertura]
- **Reviewer:** [perspectiva de arquitetura]
- **Designer:** [perspectiva de UI, se aplicável]

### Decisão Consensual
[Abordagem escolhida com justificativa]

### Responsável pela Execução
[Agent designado]
```

---

## 5. QUALITY GATES EXPANDIDOS

| Gate | Nome | Condição | Validador | Bloqueante |
|------|------|----------|-----------|------------|
| G0 | Contrato | Interfaces definidas e aprovadas | CEO | ✅ |
| G1 | Red | Testes escritos e falhando | Tester | ✅ |
| G2 | Green | Testes passando (mínimo) | Coder + Tester | ✅ |
| G3 | Edge | Edge cases adicionados e passando | Tester | ✅ |
| G4 | Review | Zero issues CRÍTICOS | Reviewer | ✅ |
| G5 | Integration | `bun test` completo 100% verde | CEO | ✅ |
| G6 | Types | `bunx tsc --noEmit` sem erros | Coder | ✅ |

**Regra: Se QUALQUER gate falhar, a pipeline PARA. Não há exceções.**

---

## 6. SELEÇÃO DE MODELO POR TAREFA

### Tabela de Modelos Ótimos

| Agent/Tarefa | Modelo | Justificativa |
|--------|--------|---------------|
| CEO — Orquestração, planejamento | `claude-opus-4-6` | Raciocínio profundo, visão sistêmica |
| Architect — Design de sistema | `claude-opus-4-6` | Pensamento estrutural, contratos |
| Coder — Implementação de código | `gpt-5.3-codex` | Otimizado para geração de código |
| Tester — Testes e QA | `claude-sonnet-4-6` | Equilíbrio velocidade/qualidade |
| Reviewer — Análise crítica | `gpt-5.5` | Chain-of-thought para encontrar falhas |
| Debugger — Diagnóstico de bugs | `gpt-5.5` | Raciocínio profundo para trace de erros |
| Designer — UI/UX | `claude-sonnet-4-6` | Criatividade + velocidade |
| Tarefas simples/repetitivas | `claude-haiku-4-5` | Velocidade máxima, custo mínimo |

### Regra de Escalação de Modelo

```
SE tarefa simples (rename, format, move) → claude-haiku-4-5
SE tarefa média (implementar feature isolada) → claude-sonnet-4-6
SE tarefa complexa (arquitetura, multi-módulo) → claude-opus-4-6
SE raciocínio profundo necessário → gpt-5.5
SE codificação pura em massa → gpt-5.3-codex
```

---

## 7. PROTOCOLO REGRESSION-FIRST (Bugs sem Teste)

### Quando um bug é reportado mas nenhum teste o detecta:

```
┌─────────────────────────────────────────────────────────┐
│  1. CEO identifica: "bug existe, nenhum teste pega"     │
│    ↓                                                     │
│  2. TESTER escreve teste que REPRODUZ o bug             │
│    ↓                                                     │
│  3. Confirma: teste FALHA (prova que o bug é real)      │
│    ↓                                                     │
│  4. CODER corrige o bug                                 │
│    ↓                                                     │
│  5. Confirma: teste PASSA (prova que o fix funciona)    │
│    ↓                                                     │
│  6. Teste permanece na suite (previne regressão)        │
│    ↓                                                     │
│  7. REVIEWER valida que o fix não introduz novos bugs   │
└─────────────────────────────────────────────────────────┘
```

### Regra Inviolável
> **NUNCA corrija um bug sem antes ter um teste que o reproduza.**
> **Se não consegue reproduzir em teste, não entendeu o bug.**

### Formato de Report
```markdown
## 🐛 BUG REPORT: [descrição curta]

### Reprodução
[Passos exatos para reproduzir]

### Comportamento Esperado
[O que deveria acontecer]

### Comportamento Atual
[O que está acontecendo]

### Teste de Reprodução
`tests/regression/[nome].test.ts`

### Hipótese de Causa
[Onde provavelmente está o problema]
```

---

## 8. PRE-MORTEM ANALYSIS (Antecipar Falhas)

### Antes de implementar qualquer feature complexa:

O CEO DEVE conduzir um **pre-mortem** — imaginar que a feature já foi implementada e FALHOU. Perguntar:

```markdown
## 💀 PRE-MORTEM: [feature]

### "A feature falhou. Por quê?"
1. [cenário de falha 1] → [mitigação]
2. [cenário de falha 2] → [mitigação]
3. [cenário de falha 3] → [mitigação]

### Pontos Cegos
- [algo que não sabemos e pode nos surpreender]

### Dependências Frágeis
- [módulo/API/serviço que pode falhar]

### Plano B
- [o que fazer se a abordagem principal não funcionar]
```

Isso PREVINE erros em vez de apenas reagir a eles.

---

## 9. CONFIDENCE SCORING (Nível de Confiança)

### Todo agent DEVE declarar sua confiança ao entregar:

```markdown
### Confiança: [ALTA | MÉDIA | BAIXA]
- **ALTA** (90%+): Testei, verifiquei, entendo completamente
- **MÉDIA** (60-90%): Funciona mas há incertezas que não pude verificar
- **BAIXA** (<60%): Solução parcial, precisa de validação adicional
```

### Regras de Confiança
- Se confiança BAIXA → CEO deve solicitar validação extra antes de avançar
- Se confiança MÉDIA → Reviewer deve prestar atenção extra nessa área
- Se confiança ALTA → fluxo normal

### Quando Declarar Confiança BAIXA (obrigatório)
- Código que interage com APIs externas sem mock disponível
- Lógica de concorrência/timing
- Código que depende de comportamento não-documentado
- Primeira vez trabalhando com esse módulo

---

## 10. KNOWLEDGE ACCUMULATION (Aprendizado Contínuo)

### Após resolver qualquer bug ou problema não-trivial:

O agent responsável DEVE registrar o aprendizado em `CLAUDE.md`:

```markdown
## Aprendizado: [data]
**Problema:** [o que aconteceu]
**Causa:** [por que aconteceu]
**Solução:** [como resolveu]
**Prevenção:** [como evitar no futuro]
```

### Padrões de Erro Conhecidos (atualizar continuamente)
- Se o mesmo tipo de erro ocorrer 2+ vezes → criar regra preventiva
- Se um módulo causa problemas frequentes → marcar para refatoração
- Se uma dependência é instável → documentar workarounds

---

## 11. ROLLBACK PROTOCOL (Quando o Fix Piora)

### Se uma correção introduz mais problemas do que resolve:

```
1. PARE imediatamente
2. Reverta TODAS as mudanças (git checkout ou undo manual)
3. Confirme que o estado anterior está restaurado (bun test)
4. Documente: "abordagem X falhou porque Y"
5. CEO convoca análise com abordagem completamente diferente
```

### Sinais de que deve fazer rollback:
- Mais testes falhando DEPOIS do fix do que antes
- Fix resolve 1 problema mas cria 2 novos
- Complexidade do fix é desproporcional ao problema
- Fix requer mudanças em 5+ arquivos para um bug simples

---

## 12. PARALLEL EXECUTION HINTS

### O que PODE rodar em paralelo:
- Tester escrevendo testes + Designer criando UI (se independentes)
- Reviewer analisando módulo A + Coder implementando módulo B
- Múltiplos testes de módulos diferentes

### O que NUNCA roda em paralelo:
- Implementação ANTES dos testes existirem
- Review ANTES da implementação terminar
- Dois agents modificando o MESMO arquivo
- Fix de bug ANTES do teste de reprodução

---

## 13. SELF-HEALING PATTERNS

### Padrões que os agents devem seguir para auto-correção:

**Pattern 1: Verify-Before-Report**
```
Antes de reportar "feito":
  1. Rode bun test (módulo)
  2. Rode bun test (suite completa)
  3. Rode bunx tsc --noEmit
  4. SE qualquer falha → corrija ANTES de reportar
```

**Pattern 2: Read-Before-Write**
```
Antes de modificar qualquer arquivo:
  1. Leia o arquivo INTEIRO
  2. Entenda o contexto (imports, exports, dependências)
  3. Identifique testes que cobrem esse arquivo
  4. SÓ ENTÃO modifique
```

**Pattern 3: Minimal-Change**
```
Para qualquer correção:
  1. Identifique a MENOR mudança que resolve
  2. Não refatore código adjacente no mesmo PR
  3. Não "melhore" coisas que não estão quebradas
  4. Uma mudança, um propósito
```

**Pattern 4: Blast-Radius-Check**
```
Antes de qualquer mudança em módulo compartilhado:
  1. Grep por todos os imports desse módulo
  2. Liste todos os consumidores
  3. Verifique que a mudança é backward-compatible
  4. Se não for → atualize TODOS os consumidores
```

---

## 14. GIT WORKFLOW (BRANCH + PR OBRIGATÓRIO)

### Regra: NUNCA trabalhar direto na main.

Todo trabalho — feature, bugfix, refatoração — DEVE seguir:

```
1. Criar branch descritiva: feat/nome, fix/nome, refactor/nome, chore/nome
2. Fazer commits na branch (mensagens em português ou inglês, ambos ok)
3. Ao finalizar: push com -u para origin
4. Abrir PR no GitHub via `gh pr create`
5. NUNCA fazer push direto na main
6. NUNCA fazer merge local na main
```

### Nomenclatura de Branch

| Tipo | Prefixo | Exemplo |
|------|---------|---------|
| Feature nova | `feat/` | `feat/mcp-http-transport` |
| Correção de bug | `fix/` | `fix/streaming-hang` |
| Refatoração | `refactor/` | `refactor/tool-registry` |
| Manutenção/config | `chore/` | `chore/update-deps` |
| Testes | `test/` | `test/coverage-edge-cases` |

### Fluxo do CEO ao Finalizar Pipeline

```
Gates G0-G6 passaram?
  → git add (arquivos específicos, NUNCA -A)
  → git commit com mensagem descritiva
  → git push -u origin <branch>
  → gh pr create --title "..." --body "..."
  → Reportar URL do PR ao usuário
```

### Regras de Segurança Git

- NUNCA `git push --force` sem permissão explícita do usuário
- NUNCA `git reset --hard` sem permissão explícita
- NUNCA commitar .env, secrets ou credentials
- Preferir commits atômicos (1 propósito por commit)
- Se pre-commit hook falhar: corrigir e criar NOVO commit (nunca --amend)

---

## 15. REGRAS UNIVERSAIS

1. **Idioma:** Toda comunicação inter-agent é em Português (Brasil).
2. **Localização de testes:** SEMPRE em `tests/` na raiz. NUNCA em `src/`.
3. **Verificação:** Todo agent DEVE rodar `bun test` antes de reportar conclusão.
4. **Transparência:** Decisões não-óbvias DEVEM ser documentadas com justificativa.
5. **Autonomia com responsabilidade:** Agents podem agir dentro do escopo delegado, mas DEVEM escalar quando fora do escopo.
6. **Zero tolerância a regressão:** Se um teste que passava começa a falhar, é prioridade MÁXIMA.
7. **Leitura obrigatória:** Todo agent lê `CLAUDE.md` + `PROTOCOL.md` antes de agir.

---

## 16. ANTI-PATTERNS (PROIBIDO NO SISTEMA)

- ❌ Agent implementa sem testes existirem
- ❌ Agent modifica teste de outro agent sem autorização do CEO
- ❌ Agent ignora veto de segurança
- ❌ Agent reporta "feito" sem rodar `bun test`
- ❌ Agent aplica fix sem diagnóstico completo
- ❌ Agent toma decisão arquitetural sem consultar CEO
- ❌ CEO avança pipeline com gate falhando
- ❌ Qualquer agent usa inglês em comunicação com o usuário
