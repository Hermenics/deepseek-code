import type { Command } from '../types.js'

const command: Command = {
  name: 'undo',
  aliases: [],
  description: 'Restore last file modified by agent',
  parse() {
    return { type: 'undo' }
  },
}

export default command
