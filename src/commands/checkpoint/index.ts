import type { Command } from '../types.js'

const command: Command = {
  name: 'checkpoint',
  aliases: [],
  description: 'Manage checkpoints',
  parse(args) {
    const sub = args[0]
    if (!sub || sub === 'save') return { type: 'checkpoint', action: 'save', label: args.slice(1).join(' ') || undefined }
    if (sub === 'list') return { type: 'checkpoint', action: 'list' }
    if (sub === 'restore') {
      const id = args[1]
      if (id) return { type: 'checkpoint', action: 'restore', id }
      return { type: 'unknown', input: 'Usage: /checkpoint restore <id>' }
    }
    return { type: 'unknown', input: 'Usage: /checkpoint [save [label] | list | restore <id>]' }
  },
}

export default command
