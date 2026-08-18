import type { Command, CommandResult } from './types.js'

import help from './help/index.js'
import model from './model/index.js'
import clear from './clear/index.js'
import compact from './compact/index.js'
import plan from './plan/index.js'
import review from './review/index.js'
import config from './config/index.js'
import agent from './agent/index.js'
import agents from './agents/index.js'
import vim from './vim/index.js'
import quit from './quit/index.js'
import checkpoint from './checkpoint/index.js'
import sessions from './sessions/index.js'
import undo from './undo/index.js'
import retry from './retry/index.js'
import cost from './cost/index.js'
import files from './files/index.js'
import tools from './tools/index.js'
import doctor from './doctor/index.js'
import verify from './verify/index.js'
import catalog from './catalog/index.js'
import system from './system/index.js'
import permissions from './permissions/index.js'
import btw from './btw/index.js'
import stats from './stats/index.js'
import memory from './memory/index.js'
import effort from './effort/index.js'
import skill from './skill/index.js'
import plugin from './plugin/index.js'
import context from './context/index.js'
import tasks from './tasks/index.js'
import task from './task/index.js'
import cwd from './cwd/index.js'
import worktree from './worktree/index.js'
import mobile from './mobile/index.js'
import gui from './gui/index.js'
import logout from './logout/index.js'
import features from './features/index.js'
import goal from './goal/index.js'
import workflow from './workflow/index.js'
import workflows from './workflows/index.js'

const commands: Command[] = [
  help,
  model,
  clear,
  compact,
  plan,
  review,
  config,
  agent,
  agents,
  vim,
  quit,
  checkpoint,
  sessions,
  undo,
  retry,
  cost,
  files,
  tools,
  doctor,
  verify,
  catalog,
  system,
  permissions,
  btw,
  stats,
  memory,
  effort,
  skill,
  plugin,
  context,
  tasks,
  task,
  cwd,
  worktree,
  mobile,
  gui,
  logout,
  goal,
  workflow,
  workflows,
  features,
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
export const COMMAND_DESCRIPTIONS = Object.fromEntries(
  commands.flatMap(c => [[`/${c.name}`, c.description], ...c.aliases.map(a => [`/${a}`, c.description])]),
) as Record<string, string>

export { HELP_TEXT } from './help/index.js'
export { REVIEW_PROMPT } from './review/index.js'
export type { CommandResult, Command, Model } from './types.js'
