import type { Command } from '../types.js'

/** `/system`: shows the active mode and permission summary from the agent's system prompt. */
const command: Command = {
  name: 'system',
  aliases: [],
  description: 'Show active mode and permission summary',
  parse() {
    return { type: 'system' }
  },
}

export default command
