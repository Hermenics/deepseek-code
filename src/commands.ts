export type Model = 'deepseek-chat' | 'deepseek-reasoner'

export type CommandResult =
  | { type: 'quit' }
  | { type: 'model'; model: Model }
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
      return { type: 'unknown', input: 'Usage: /agent <name>' }
    }
    case 'model': {
      const m = args[0] as Model
      if (m && MODELS.includes(m)) return { type: 'model', model: m }
      return { type: 'unknown', input: `Usage: /model <${MODELS.join('|')}>` }
    }
    case 'checkpoint': {
      const sub = args[0]
      if (!sub || sub === 'save') return { type: 'checkpoint', action: 'save', label: args.slice(1).join(' ') || undefined }
      if (sub === 'list') return { type: 'checkpoint', action: 'list' }
      if (sub === 'restore') {
        const id = args[1]
        if (id) return { type: 'checkpoint', action: 'restore', id }
        return { type: 'unknown', input: 'Usage: /checkpoint restore <id>' }
      }
      return { type: 'unknown', input: 'Usage: /checkpoint [save [label] | list | restore <id>]' }
    }
    case 'sessions': return { type: 'sessions' }
    default: return { type: 'unknown', input: `Unknown command: /${cmd}. Type /help for commands.` }
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
  '/model deepseek-chat',
  '/model deepseek-reasoner',
]

export const HELP_TEXT = `Commands:
  /agent <name>                              load a custom agent
  /agents                                    list available agents
  /model <deepseek-chat|deepseek-reasoner>  switch model
  /theme                                     change color theme
  /clear                                     clear chat history
  /compact                                   summarize history to save context
  /undo                                      restore last file modified by agent
  /retry                                     re-run last message
  /refine                                    toggle prompt refinement on/off
  /tools                                     list all available tools (built-in + MCP)
  /system                                    show active system prompt
  /cost                                      show estimated session cost
  /files                                     list files modified this session
  /sessions                                  list recent sessions (use --resume <id> to restore)
  /checkpoint [save [label]]                 save current state
  /checkpoint list                           list saved checkpoints
  /checkpoint restore <id>                   restore a checkpoint
  /quit  /q                                  exit`
