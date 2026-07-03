import type { Command, CommandResult } from '../types.js'

const REPO_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/
const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

export type SkillCommandResult =
  | { type: 'skill'; action: 'install'; repo: string }
  | { type: 'skill'; action: 'list' }
  | { type: 'skill'; action: 'remove'; name: string }
  | { type: 'skill'; action: 'update'; name: string }
  | { type: 'skill'; action: 'help' }
  | { type: 'skill'; action: 'error'; message: string }

export function parseSkillCommand(args: string[]): SkillCommandResult {
  const sub = args[0]?.toLowerCase()

  if (!sub) return { type: 'skill', action: 'help' }

  switch (sub) {
    case 'install': {
      const repo = args[1]
      if (!repo) return { type: 'skill', action: 'error', message: 'Usage: /skill install <owner/repo>' }
      if (!REPO_PATTERN.test(repo)) return { type: 'skill', action: 'error', message: `Invalid repo format: "${repo}". Expected: owner/repo` }
      return { type: 'skill', action: 'install', repo }
    }
    case 'list':
      return { type: 'skill', action: 'list' }
    case 'remove': {
      const name = args[1]
      if (!name) return { type: 'skill', action: 'error', message: 'Usage: /skill remove <name>' }
      if (!SKILL_NAME_PATTERN.test(name)) return { type: 'skill', action: 'error', message: `Invalid skill name: "${name}". Must be kebab-case (lowercase letters, numbers, hyphens)` }
      return { type: 'skill', action: 'remove', name }
    }
    case 'update': {
      const name = args[1]
      if (!name) return { type: 'skill', action: 'error', message: 'Usage: /skill update <name>' }
      if (!SKILL_NAME_PATTERN.test(name)) return { type: 'skill', action: 'error', message: `Invalid skill name: "${name}". Must be kebab-case (lowercase letters, numbers, hyphens)` }
      return { type: 'skill', action: 'update', name }
    }
    default:
      return { type: 'skill', action: 'help' }
  }
}

const skill: Command = {
  name: 'skill',
  aliases: ['skills'],
  description: 'Manage skills (install, list, remove, update)',
  parse(args: string[]): CommandResult {
    return parseSkillCommand(args)
  },
}

export default skill
