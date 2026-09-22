import type { Command } from '../types.js'

/** `/retry`: re-runs the last user message. */
const command: Command = {
  name: 'retry',
  aliases: [],
  description: 'Re-run last message',
  parse() {
    return { type: 'retry' }
  },
}

export default command
