export type Model = 'deepseek-chat' | 'deepseek-reasoner'

export type CommandResult =
  | { type: 'quit' }
  | { type: 'model'; model: Model }
  | { type: 'clear' }
  | { type: 'help' }
  | { type: 'agent'; name: string }
  | { type: 'agents' }
  | { type: 'theme' }
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
    case 'help': return { type: 'help' }
    case 'agents': return { type: 'agents' }
    case 'theme': return { type: 'theme' }
    case 'agent': {
      const name = args[0]
      if (name) return { type: 'agent', name }
      return { type: 'unknown', input: 'Usage: /agent <name>' }
    }
    case 'model': {
      const m = args[0] as Model
      if (m && MODELS.includes(m)) return { type: 'model', model: m }
      return { type: 'unknown', input: `Usage: /model <${MODELS.join('|')}>` }
    }
    default: return { type: 'unknown', input: `Unknown command: /${cmd}. Type /help for commands.` }
  }
}

export const COMMAND_SUGGESTIONS = [
  '/quit',
  '/q',
  '/clear',
  '/help',
  '/agent',
  '/agents',
  '/theme',
  '/model deepseek-chat',
  '/model deepseek-reasoner',
]

export const HELP_TEXT = `Commands:
  /agent <name>                              load a custom agent
  /agents                                    list available agents
  /model <deepseek-chat|deepseek-reasoner>  switch model
  /theme                                     change color theme
  /clear                                     clear chat history
  /quit  /q                                  exit`
