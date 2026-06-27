# Task: Ciclo de Modos de Interação (Shift+Tab)

**Status:** ✅ Concluído  
**Versão alvo:** 0.3.0  
**Prioridade:** Alta  

---

## Contexto

Implementar um ciclo de modos de interação inspirado no Claude Code e Kiro CLI, onde o usuário alterna entre modos pressionando **Shift+Tab**. A troca é sequencial e circular (volta ao início após o último modo).

---

## Modos do Ciclo (ordem sequencial)

| Ordem | Modo            | Descrição                                                                                      |
| :---: | :-------------- | :--------------------------------------------------------------------------------------------- |
|   1   | **Chat**        | Conversa livre. Pode ler arquivos e web, mas não escreve nem executa shell autonomamente.      |
|   2   | **Plan**        | Lê o projeto e gera um prompt/plano pronto. Não executa nada. Resultado é para o usuário usar. |
|   3   | **Agent**       | Executa autonomamente, multi-step, sem pedir permissão a cada tool call.                       |
|   4   | **Auto-accept** | Igual ao Agent, mas aceita confirmações destrutivas automaticamente. Só o usuário ativa.       |

Ciclo: `Chat → Plan → Agent → Auto-accept → Chat → ...`

---

## Arquitetura Técnica (baseada no código real)

### Detecção do Shift+Tab
O `InputBox.tsx` já tem um listener manual de `stdin` com `parseKey()`. Shift+Tab no terminal emite a sequência `\x1b[Z`. Basta adicionar esse case no `parseKey()` e tratar no handler `onData`.

### Estado do modo
O estado `interactionMode` vive no `App.tsx` (junto com os demais estados como `isLoading`, `agentPhase`, etc.) e é passado via props para `InputBox` e `StatusBar`.

### Exibição na UI
- `InputBox.tsx` — mostrar o modo atual no separador superior (linha com `agentLabel`)
- `StatusBar.tsx` — adicionar badge do modo ao lado do modelo

### Comportamento por modo
| Modo            | Comportamento                                                   | Ferramentas pré-permitidas         |
| :-------------- | :-------------------------------------------------------------- | :--------------------------------- |
| **Chat**        | Conversa livre, sem execução autônoma                           | `read_file`, `web_fetch`, `shell`  |
| **Plan**        | Gera um plano/prompt final para o usuário revisar e executar    | `read_file`, `web_fetch`           |
| **Agent**       | Executa autonomamente, multi-step, sem pedir permissão por tool | `read_file`, `write_file`, `shell` |
| **Auto-accept** | Igual ao Agent + aceita `ConfirmPrompt` automaticamente         | `read_file`, `write_file`, `shell` |

### Plan Mode — fluxo detalhado
- O resultado do Plan Mode é um **prompt pronto**, que o usuário pode:
  - Copiar, trocar para Agent mode e enviar manualmente
  - Ou simplesmente trocar para Agent mode e mandar executar direto
- O Plan Mode **não executa nada** — só lê e planeja

### Mudança automática de modo pelo modelo
O DeepSeek pode mudar o modo automaticamente, com as seguintes regras:

| Situação                                                | Transição                      | Aviso na UI  |
| :------------------------------------------------------ | :----------------------------- | :----------- |
| Usuário está em Plan e pede implementação               | Plan → Agent                   | ✅ Sim, avisa |
| Usuário está em Agent com prompt vago/complexo          | Agent → Plan (interno) → Agent | ✅ Sim, avisa |
| Qualquer modo → Auto-accept                             | ❌ **PROIBIDO**                 | —            |
| Usuário está em auto-accept e pede explicação de código | auto-accept → Chat             | ✅ Sim, avisa |
**Regra crítica:** O modelo **nunca pode ativar Auto-accept sozinho**. Esse modo só é ativado pelo usuário via Shift+Tab.

**Sobre o Plan interno automático:** quando o modelo ativa Plan por conta própria (prompt vago no Agent mode), ele **não interage com o usuário** — planeja internamente e já muda para Agent para executar. É transparente, só aparece o aviso na UI.

### Aviso de mudança de modo na UI
- Exibir uma linha de notificação no chat quando o modelo mudar o modo automaticamente
- Formato: `⟳ Modo alterado: Agent → Plan (prompt muito vago, planejando antes de executar)`
- Cor: amarelo/warning

### Sequência da tecla Shift+Tab no terminal
`\x1b[Z` — sequência ANSI padrão para Shift+Tab (xterm/VTE/kitty)

---

## Escopo

### Arquivos a modificar
- `src/ui/input/InputBox.tsx` — detectar `\x1b[Z`, chamar `onModeChange`
- `src/ui/App.tsx` — estado `interactionMode`, passar para InputBox/StatusBar, alterar comportamento por modo
- `src/ui/layout/StatusBar.tsx` — exibir badge do modo atual

### Arquivos a criar
- `src/ui/interactionMode.ts` — constantes e lógica do ciclo (puro, testável)
- `src/ui/interactionMode.test.ts` — testes unitários

### Fora do escopo (por agora)
- Persistência do modo entre sessões
- Atalho customizável

### Limpeza associada
- Remover `src/agent/promptRefiner.ts` e todas as referências a ele em `agent.ts`
- O **Plan mode** substitui completamente a função do refiner — quando ativo, o próprio modelo planeja antes de agir, sem precisar de um pré-processamento externo do prompt
- Remover também o comando `/refine` de `commands.ts` e `InputBox.tsx`

---

## Critérios de Aceitação

- [ ] Pressionar `Shift+Tab` alterna para o próximo modo na sequência
- [ ] Após o último modo (`Auto-accept`), volta para `Chat`
- [ ] O modo atual é exibido visivelmente na interface (badge na StatusBar + separador do InputBox)
- [ ] A troca de modo é instantânea e não interrompe o fluxo atual
- [ ] Cada modo restringe as ferramentas disponíveis conforme a tabela de permissões
- [ ] Plan Mode entrega um prompt/plano pronto, sem executar nada
- [ ] O modelo pode mudar automaticamente entre Chat/Plan/Agent, com aviso na UI
- [ ] O modelo **nunca** pode ativar Auto-accept automaticamente
- [ ] Quando o modelo ativa Plan internamente (prompt vago no Agent), ele não interage com o usuário — planeja e já executa
- [ ] Aviso de mudança automática de modo aparece em amarelo no chat
- [ ] Funciona corretamente em terminal (Ink/TTY)

---

## Critérios de Teste

- [ ] Ciclo completo pelo usuário: `Chat → Plan → Agent → Auto-accept → Chat`
- [ ] Estado inicial é sempre `Chat`
- [ ] `\x1b[Z` (Shift+Tab) dispara a troca de modo
- [ ] `\t` (Tab simples) NÃO dispara a troca de modo
- [ ] Plan mode: ferramentas `write_file` e `shell` estão bloqueadas
- [ ] Chat mode: ferramenta `write_file` está bloqueada
- [ ] Agent mode: todas as ferramentas permitidas, sem `ToolPermissionPrompt`
- [ ] Auto-accept: igual ao Agent + `ConfirmPrompt` auto-aceito
- [ ] Modelo não consegue transitar para Auto-accept automaticamente
- [ ] Aviso de mudança automática de modo é exibido corretamente na UI
- [ ] Edge case: troca rápida e repetida não quebra o estado

---

## Referências

- Inspiração: Claude Code (Shift+Tab cycle), Kiro CLI (mode switcher)
- Arquivos relacionados: verificar `src/app.tsx`, `src/components/`, state management atual
- Versão atual do projeto: `0.2.10`
