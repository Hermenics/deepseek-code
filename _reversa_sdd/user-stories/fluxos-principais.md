# User Stories — deepseek-code

> Gerado pelo Redator (Reversa) em 2026-06-23
> Escala de confiança: 🟢 CONFIRMADO | 🟡 INFERIDO | 🔴 LACUNA

---

## Fluxo: Conversa com Agente

### US-01: Enviar mensagem ao agente 🟢

**Como** desenvolvedor,
**Quero** digitar uma mensagem no terminal e enviá-la ao LLM,
**Para que** receba assistência de programação com contexto do meu projeto.

**Critérios de Aceitação:**
- Dado que estou na CLI com sessão ativa, quando digito texto e pressiono Enter, então o agente envia ao LLM e exibe resposta em streaming
- Dado que o LLM retorna tool_calls, quando processados, então as tools executam e o resultado volta ao LLM automaticamente

---

### US-02: Executar tool via agente 🟢

**Como** desenvolvedor,
**Quero** que o agente execute operações no meu projeto (editar arquivos, rodar comandos),
**Para que** mudanças sejam feitas automaticamente sem eu sair do chat.

**Critérios de Aceitação:**
- Dado que estou em Build mode e a tool é não-destrutiva, quando o LLM solicita, então executa sem perguntar
- Dado que a tool é destrutiva (rm -rf, git reset), quando detectada, então me pede confirmação antes
- Dado que estou em Plan mode, quando tool de escrita é solicitada, então é bloqueada

---

### US-03: Trocar modo de interação 🟢

**Como** desenvolvedor,
**Quero** alternar entre Plan, Build e Auto via Shift+Tab,
**Para que** controle o nível de autonomia do agente conforme minha confiança no momento.

**Critérios de Aceitação:**
- Dado Shift+Tab pressionado em Build, quando processado, então muda para Auto
- Dado que estou em Auto e pressiono Shift+Tab, quando processado, então volta para Plan
- Dado que o LLM tenta ativar Auto, quando processado, então é bloqueado

---

## Fluxo: Context Management

### US-04: Auto-compact do contexto 🟢

**Como** desenvolvedor,
**Quero** que o agente compacte automaticamente o histórico quando fica grande demais,
**Para que** a conversa não pare de funcionar por limite de tokens.

**Critérios de Aceitação:**
- Dado que uso de contexto passa de 85%, quando o agente detecta, então compacta automaticamente
- Dado que compact falha 3 vezes seguidas, quando detecta, então para de tentar (circuit breaker)

---

### US-05: Desfazer escrita de arquivo 🟢

**Como** desenvolvedor,
**Quero** poder desfazer a última escrita feita pelo agente com /undo,
**Para que** reverta mudanças indesejadas rapidamente.

**Critérios de Aceitação:**
- Dado que o agente escreveu em um arquivo, quando digito /undo, então o arquivo volta ao estado anterior
- Dado que o stack de undo está vazio, quando digito /undo, então vejo "nothing to undo"

---

## Fluxo: Sessões e Checkpoints

### US-06: Retomar sessão anterior 🟢

**Como** desenvolvedor,
**Quero** listar e retomar sessões anteriores,
**Para que** continue um trabalho começado em outra sessão.

**Critérios de Aceitação:**
- Dado que existem sessões salvas, quando digito /sessions, então vejo lista com IDs e datas
- Dado que seleciono uma sessão, quando confirmado, então histórico é restaurado

---

### US-07: Salvar checkpoint 🟢

**Como** desenvolvedor,
**Quero** salvar um snapshot do estado atual da conversa,
**Para que** possa voltar a esse ponto se algo der errado depois.

**Critérios de Aceitação:**
- Dado /checkpoint save "antes do refactor", quando executo, então snapshot é salvo com label
- Dado /checkpoint restore {id}, quando executo, então estado é restaurado

---

## Fluxo: Providers

### US-08: Trocar provider/modelo 🟢

**Como** desenvolvedor,
**Quero** trocar entre providers (DeepSeek, Bedrock, Vertex, Local) e modelos em runtime,
**Para que** use o modelo mais adequado para cada tarefa.

**Critérios de Aceitação:**
- Dado /model deepseek-reasoner, quando executo, então modelo muda imediatamente
- Dado /models, quando executo, então vejo todos os modelos disponíveis por provider

---

## Fluxo: Segurança

### US-09: Proteção contra operações perigosas 🟢

**Como** desenvolvedor,
**Quero** que o agente me proteja de operações destrutivas acidentais,
**Para que** não perca trabalho por erro do LLM.

**Critérios de Aceitação:**
- Dado comando `rm -rf /` via shell, quando detectado, então pede confirmação
- Dado path fora do projeto (../../etc/passwd), quando tentado, então é bloqueado
- Dado arquivo .env, quando agente tenta ler, então é bloqueado

---

### US-10: Hooks personalizados 🟢

**Como** desenvolvedor avançado,
**Quero** configurar hooks que executam antes/depois de tools,
**Para que** adicione validações customizadas ao fluxo do agente.

**Critérios de Aceitação:**
- Dado hook PreToolUse em settings, quando shell tool é chamada, então meu script roda antes
- Dado que meu script retorna "block", quando processado, então a tool não executa
- Dado hooks em .deepseek/settings.json do projeto, quando carregados, então são ignorados (segurança)

---

## Fluxo: Customização

### US-11: Usar agente custom 🟢

**Como** desenvolvedor,
**Quero** criar agentes com prompts e tools customizados,
**Para que** tenha assistentes especializados para diferentes tarefas.

**Critérios de Aceitação:**
- Dado JSON em .deepseek/agents/reviewer.json, quando digito /agent reviewer, então prompt e tools mudam
- Dado /agents, quando executo, então vejo lista de agentes disponíveis

---

### US-12: Vim mode 🟢

**Como** desenvolvedor que usa vim,
**Quero** keybindings vim no input da CLI,
**Para que** edite texto com os atalhos que já conheço.

**Critérios de Aceitação:**
- Dado /vim ativado, quando pressiono Esc, então entro em Normal mode
- Dado Normal mode, quando digito `dw`, então deleta uma word
- Dado Normal mode, quando digito `i`, então entro em Insert mode

---

## Fluxo: Setup

### US-13: Primeira execução 🟢

**Como** novo usuário,
**Quero** um wizard de configuração na primeira execução,
**Para que** configure meu provider e API key sem editar JSON manualmente.

**Critérios de Aceitação:**
- Dado primeira execução sem config, quando app inicia, então exibe wizard
- Dado que insiro API key válida, quando testada, então salva e prossegue
- Dado API key inválida, quando testada, então mostra erro e pede novamente
