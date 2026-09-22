import type { Command } from '../types.js'

/** `/undo [all|list]`: restores the last agent-modified file, all of them, or lists what can be undone. */
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
