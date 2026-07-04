import type { Command, CommandResult } from '../types.js'
import { REPO_PATTERN, PLUGIN_NAME_PATTERN } from '../../plugins/validation.js'

export function parsePluginCommand(args: string[]): CommandResult {
  const sub = args[0]?.toLowerCase()

  if (!sub) return { type: 'plugin', action: 'help' }

  switch (sub) {
    case 'install': {
      const repo = args[1]
      if (!repo) return { type: 'plugin', action: 'error', message: 'Usage: /plugin install <owner/repo>' }
      if (!REPO_PATTERN.test(repo)) return { type: 'plugin', action: 'error', message: `Invalid repo format: "${repo}". Expected: owner/repo` }
      return { type: 'plugin', action: 'install', repo }
    }
    case 'list':
      return { type: 'plugin', action: 'list' }
    case 'remove': {
      const name = args[1]
      if (!name) return { type: 'plugin', action: 'error', message: 'Usage: /plugin remove <name>' }
      if (!PLUGIN_NAME_PATTERN.test(name)) return { type: 'plugin', action: 'error', message: `Invalid plugin name: "${name}". Must be kebab-case` }
      return { type: 'plugin', action: 'remove', name }
    }
    case 'update': {
      const name = args[1]
      if (!name) return { type: 'plugin', action: 'error', message: 'Usage: /plugin update <name>' }
      if (!PLUGIN_NAME_PATTERN.test(name)) return { type: 'plugin', action: 'error', message: `Invalid plugin name: "${name}". Must be kebab-case` }
      return { type: 'plugin', action: 'update', name }
    }
    default:
      return { type: 'plugin', action: 'help' }
  }
}

const plugin: Command = {
  name: 'plugin',
  aliases: ['plugins'],
  description: 'Manage plugins (install, list, remove, update)',
  parse(args: string[]): CommandResult {
    return parsePluginCommand(args)
  },
}

export default plugin
