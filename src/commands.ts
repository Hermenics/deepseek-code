export type Model = 'deepseek-chat' | 'deepseek-reasoner'

export type CommandResult =
  | { type: 'quit' }
  | { type: 'model'; model: Model }
  | { type: 'models' }
  | { type: 'language' }
  | { type: 'clear' }
  | { type: 'compact' }
  | { type: 'help' }
  | { type: 'agent'; name: string }
  | { type: 'agents' }
  | { type: 'theme' }
  | { type: 'undo' }
  | { type: 'retry' }
  | { type: 'cost' }
  | { type: 'files' }
  | { type: 'refine' }
  | { type: 'tools' }
  | { type: 'system' }
  | { type: 'checkpoint'; action: 'save'; label?: string }
  | { type: 'checkpoint'; action: 'list' }
  | { type: 'checkpoint'; action: 'restore'; id: string }
  | { type: 'sessions' }
  | { type: 'plan'; task: string }
  | { type: 'review'; target: string }
  | { type: 'unknown'; input: string }

const MODELS: Model[] = ['deepseek-chat', 'deepseek-reasoner']

export function parseCommand(input: string): CommandResult | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null

  const [cmd, ...args] = trimmed.slice(1).split(/\s+/)

  switch (cmd) {
    case 'q':
    case 'quit': return { type: 'quit' }
    case 'clear': return { type: 'clear' }
    case 'compact': return { type: 'compact' }
    case 'help': return { type: 'help' }
    case 'agents': return { type: 'agents' }
    case 'models': return { type: 'models' }
    case 'language': return { type: 'language' }
    case 'theme': return { type: 'theme' }
    case 'undo': return { type: 'undo' }
    case 'retry': return { type: 'retry' }
    case 'cost': return { type: 'cost' }
    case 'files': return { type: 'files' }
    case 'refine': return { type: 'refine' }
    case 'tools': return { type: 'tools' }
    case 'system': return { type: 'system' }
    case 'agent': {
      const name = args[0]
      if (name) return { type: 'agent', name }
      return { type: 'unknown', input: 'Uso: /agent <nome>' }
    }
    case 'model': {
      const m = args[0] as Model
      if (m && MODELS.includes(m)) return { type: 'model', model: m }
      return { type: 'unknown', input: `Uso: /model <${MODELS.join('|')}>` }
    }
    case 'checkpoint': {
      const sub = args[0]
      if (!sub || sub === 'save') return { type: 'checkpoint', action: 'save', label: args.slice(1).join(' ') || undefined }
      if (sub === 'list') return { type: 'checkpoint', action: 'list' }
      if (sub === 'restore') {
        const id = args[1]
        if (id) return { type: 'checkpoint', action: 'restore', id }
        return { type: 'unknown', input: 'Uso: /checkpoint restore <id>' }
      }
      return { type: 'unknown', input: 'Uso: /checkpoint [save [label] | list | restore <id>]' }
    }
    case 'sessions': return { type: 'sessions' }
    case 'plan': {
      const task = args.join(' ')
      if (!task) return { type: 'unknown', input: 'Uso: /plan <tarefa>' }
      return { type: 'plan', task }
    }
    case 'review': {
      const target = args.join(' ')
      return { type: 'review', target }
    }
    default: return { type: 'unknown', input: `Comando desconhecido: /${cmd}. Use /help para ver os comandos.` }
  }
}

export const COMMAND_SUGGESTIONS = [
  '/quit',
  '/q',
  '/clear',
  '/compact',
  '/help',
  '/agent',
  '/agents',
  '/theme',
  '/models',
  '/language',
  '/undo',
  '/retry',
  '/cost',
  '/files',
  '/refine',
  '/tools',
  '/system',
  '/checkpoint',
  '/checkpoint list',
  '/sessions',
  '/plan',
  '/review',
]

export const HELP_TEXT = `Comandos:
  /agent <nome>          carregar um agente customizado
  /agents                listar agentes disponíveis
  /models                trocar modelo (interativo)
  /language              mudar idioma preferido
  /theme                 mudar tema de cores
  /clear                 limpar histórico do chat
  /compact               resumir histórico para economizar contexto
  /undo                  restaurar último arquivo modificado pelo agente
  /retry                 reexecutar última mensagem
  /refine                ativar/desativar refinamento de prompt
  /tools                 listar todas as ferramentas disponíveis
  /system                mostrar system prompt ativo
  /cost                  mostrar custo estimado da sessão
  /files                 listar arquivos modificados na sessão
  /sessions              listar sessões recentes (use --resume <id> para restaurar)
  /checkpoint [save [label]]     salvar estado atual
  /checkpoint list               listar checkpoints salvos
  /checkpoint restore <id>       restaurar um checkpoint
  /plan <tarefa>         planejar implementação de uma tarefa
  /review [arquivo]      revisar código do projeto ou arquivo específico
  /quit  /q              sair`

export const PLAN_PROMPT = (task: string) => `Você é um arquiteto de software sênior. Analise o codebase atual e crie um plano de implementação detalhado para a seguinte tarefa:

**Tarefa:** ${task}

Seu plano deve conter:
1. **Entendimento** — o que precisa ser feito e por quê
2. **Arquivos afetados** — quais arquivos criar, modificar ou remover
3. **Etapas de implementação** — passos ordenados e executáveis
4. **Riscos e mitigações** — o que pode dar errado e como evitar
5. **Critérios de aceitação** — como saber que está pronto

Explore o codebase antes de responder. Seja preciso, direto e acionável.`

export const REVIEW_PROMPT = (target: string) => `Você é um revisor de código sênior. Faça uma revisão completa do ${target ? `arquivo/módulo: ${target}` : 'código modificado recentemente neste projeto'}.

Analise e reporte:
1. **Bugs e problemas lógicos** — erros reais ou potenciais
2. **Qualidade e legibilidade** — código confuso, nomes ruins, duplicação
3. **Performance** — operações desnecessárias, loops ineficientes
4. **Segurança** — inputs não validados, exposição de dados
5. **Melhorias sugeridas** — refatorações que valem a pena

Para cada problema encontrado, mostre o trecho problemático e a correção sugerida. Seja direto e objetivo.`
