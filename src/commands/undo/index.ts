import type { Command } from '../types.js'

const command: Command = {
  name: 'undo',
  aliases: [],
  description: 'Restore last file modified by agent (all | list)',
  parse(args) {
    const sub = args[0]
    if (sub === 'all') return { type: 'undo', action: 'all' }
    if (sub === 'list') return { type: 'undo', action: 'list' }
    return { type: 'undo' }
  },
}

export default command
