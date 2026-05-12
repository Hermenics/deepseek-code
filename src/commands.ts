export type Model = string

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
  | { type: 'tools' }
  | { type: 'system' }
  | { type: 'checkpoint'; action: 'save'; label?: string }
  | { type: 'checkpoint'; action: 'list' }
  | { type: 'checkpoint'; action: 'restore'; id: string }
  | { type: 'sessions' }
  | { type: 'plan'; task: string }
  | { type: 'review'; target: string }
  | { type: 'permissions' }
  | { type: 'msg'; note: string }
  | { type: 'vim' }
  | { type: 'stats' }
  | { type: 'unknown'; input: string }


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
    case 'tools': return { type: 'tools' }
    case 'system': return { type: 'system' }
    case 'agent': {
      const name = args[0]
      if (name) return { type: 'agent', name }
      return { type: 'unknown', input: 'Usage: /agent <name>' }
    }
    case 'model': {
      const m = args[0]
      if (m) return { type: 'model', model: m }
      return { type: 'unknown', input: 'Usage: /model <model-name>' }
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
    case 'plan': {
      const task = args.join(' ')
      if (!task) return { type: 'unknown', input: 'Usage: /plan <task>' }
      return { type: 'plan', task }
    }
    case 'review': {
      const target = args.join(' ')
      return { type: 'review', target }
    }
    case 'permissions': return { type: 'permissions' }
    case 'msg':
    case 'btw': {
      const note = args.join(' ')
      if (!note) return { type: 'unknown', input: 'Usage: /msg <note> — add a note without interrupting the agent' }
      return { type: 'msg', note }
    }
    case 'vim': return { type: 'vim' }
    case 'stats': return { type: 'stats' }
    default: return { type: 'unknown', input: `Unknown command: /${cmd}. Use /help to see available commands.` }
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
  '/tools',
  '/system',
  '/checkpoint',
  '/checkpoint list',
  '/sessions',
  '/plan',
  '/review',
  '/permissions',
  '/msg',
  '/vim',
  '/stats',
]

export const HELP_TEXT = `Commands:
  /agent <name>          load a custom agent
  /agents                list available agents
  /models                switch model (interactive)
  /language              change preferred language
  /theme                 change color theme
  /clear                 clear chat history
  /compact               summarize history to save context
  /undo                  restore last file modified by agent
  /retry                 re-run last message
  /tools                 list all available tools
  /system                show active system prompt
  /cost                  show estimated session cost
  /files                 list files modified this session
  /sessions              list recent sessions (use --resume <id> to restore)
  /checkpoint [save [label]]     save current state
  /checkpoint list               list saved checkpoints
  /checkpoint restore <id>       restore a checkpoint
  /plan <task>           plan implementation of a task
  /review [file]         review project code or a specific file
  /permissions           show current tool permission settings
  /msg <note>            add a note for the agent without interrupting it
  /vim                   toggle vim keybindings (normal/insert mode)
  /stats                 show session statistics
  /quit  /q              exit`

export const PLAN_PROMPT = (task: string) => `You are a senior software architect. Analyze the current codebase and create a detailed implementation plan for the following task:

**Task:** ${task}

Your plan must include:
1. **Understanding** — what needs to be done and why
2. **Affected files** — which files to create, modify, or remove
3. **Implementation steps** — ordered, actionable steps
4. **Risks and mitigations** — what could go wrong and how to prevent it
5. **Acceptance criteria** — how to know it's done

Explore the codebase before responding. Be precise, direct, and actionable.`

export const REVIEW_PROMPT = (target: string) => `You are a senior code reviewer. Perform a thorough review of ${target ? `the file/module: ${target}` : 'code recently modified in this project'}.

Analyze and report:
1. **Bugs and logic issues** — real or potential errors
2. **Quality and readability** — confusing code, bad names, duplication
3. **Performance** — unnecessary operations, inefficient loops
4. **Security** — unvalidated inputs, data exposure
5. **Suggested improvements** — refactors worth doing

For each issue found, show the problematic snippet and the suggested fix. Be direct and objective.`
