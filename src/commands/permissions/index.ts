import type { Command } from '../types.js'

/** `/permissions`: shows the current tool permission settings. */
const command: Command = {
  name: 'permissions',
  aliases: [],
  description: 'Show tool permission settings',
  parse() {
    return { type: 'permissions' }
  },
}

export default command
