export type Model = string
export type EffortLevel = 'low' | 'high' | 'max'

export type CommandResult =
  | { type: 'quit' }
  | { type: 'model'; model: Model }
  | { type: 'models' }
  | { type: 'config' }
  | { type: 'clear' }
  | { type: 'compact' }
  | { type: 'help' }
  | { type: 'agent'; name: string }
  | { type: 'agents' }
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
  | { type: 'skill'; action: 'install'; repo: string }
  | { type: 'skill'; action: 'list' }
  | { type: 'skill'; action: 'remove'; name: string }
  | { type: 'skill'; action: 'update'; name: string }
  | { type: 'skill'; action: 'help' }
  | { type: 'skill'; action: 'error'; message: string }
  | { type: 'plugin'; action: 'install'; repo: string }
  | { type: 'plugin'; action: 'list' }
  | { type: 'plugin'; action: 'remove'; name: string }
  | { type: 'plugin'; action: 'update'; name: string }
  | { type: 'plugin'; action: 'help' }
  | { type: 'plugin'; action: 'error'; message: string }
  | { type: 'context' }
  | { type: 'tasks' }
  | { type: 'task'; id: string; action: 'status' | 'cancel' | 'resume' | 'result' | 'integrate' | 'cleanup' }
  | { type: 'task'; id: string; action: 'message'; message: string }
  | { type: 'worktree'; action: 'create' }
  | { type: 'worktree'; action: 'enter'; name: string }
  | { type: 'worktree'; action: 'exit'; keep: boolean }
  | { type: 'worktree'; action: 'list' }
  | { type: 'worktree'; action: 'status' }
  | { type: 'logout' }
  | { type: 'cwd'; path?: string }
  | { type: 'unknown'; input: string }

export interface Command {
  name: string
  aliases: string[]
  description: string
  parse(args: string[]): CommandResult
}
