import type { Command } from '../types.js'

const command: Command = {
  name: 'compact',
  aliases: [],
  description: 'Summarize history to save context',
  parse() {
    return { type: 'compact' }
  },
}

export default command
