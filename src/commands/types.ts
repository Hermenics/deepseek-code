export type Model = string
export type EffortLevel = 'low' | 'high' | 'max'

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
  | { type: 'undo'; action: 'all' }
  | { type: 'undo'; action: 'list' }
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
  | { type: 'memory'; action: 'show' }
  | { type: 'memory'; action: 'clear'; target?: 'agent' | 'user' }
  | { type: 'effort'; action: 'status' }
  | { type: 'effort'; action: 'set'; level: EffortLevel }
  | { type: 'enchant-prompt' }
  | { type: 'skill'; action: 'install'; repo: string }
  | { type: 'skill'; action: 'list' }
  | { type: 'skill'; action: 'remove'; name: string }
  | { type: 'skill'; action: 'update'; name: string }
  | { type: 'skill'; action: 'help' }
  | { type: 'skill'; action: 'error'; message: string }
  | { type: 'unknown'; input: string }

export interface Command {
  name: string
  aliases: string[]
  description: string
  parse(args: string[]): CommandResult
}
