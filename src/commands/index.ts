import type { Command, CommandResult } from './types.js'

import help from './help/index.js'
import model from './model/index.js'
import clear from './clear/index.js'
import compact from './compact/index.js'
import plan from './plan/index.js'
import review from './review/index.js'
import theme from './theme/index.js'
import agent from './agent/index.js'
import agents from './agents/index.js'
import vim from './vim/index.js'
import quit from './quit/index.js'
import checkpoint from './checkpoint/index.js'
import sessions from './sessions/index.js'
import language from './language/index.js'
import undo from './undo/index.js'
import retry from './retry/index.js'
import cost from './cost/index.js'
import files from './files/index.js'
import tools from './tools/index.js'
import system from './system/index.js'
import permissions from './permissions/index.js'
import msg from './msg/index.js'
import stats from './stats/index.js'
import models from './models/index.js'
import memory from './memory/index.js'
import effort from './effort/index.js'

const commands: Command[] = [
  help,
  model,
  clear,
  compact,
  plan,
  review,
  theme,
  agent,
  agents,
  vim,
  quit,
  checkpoint,
  sessions,
  language,
  undo,
  retry,
  cost,
  files,
  tools,
  system,
  permissions,
  msg,
  stats,
  models,
  memory,
  effort,
]

export function parseCommand(input: string): CommandResult | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null
  const [cmd, ...args] = trimmed.slice(1).split(/\s+/)

  for (const command of commands) {
    if (command.name === cmd || command.aliases.includes(cmd)) {
      return command.parse(args)
    }
  }

  return { type: 'unknown', input: `Unknown command: /${cmd}. Use /help to see available commands.` }
}

export const COMMAND_SUGGESTIONS = commands.flatMap(c => [`/${c.name}`, ...c.aliases.map(a => `/${a}`)])

export { HELP_TEXT } from './help/index.js'
export { PLAN_PROMPT } from './plan/index.js'
export { REVIEW_PROMPT } from './review/index.js'
export type { CommandResult, Command, Model } from './types.js'
