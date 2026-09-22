import type { Command } from '../types.js'

/** `/quit` (alias `/q`): exits the application. */
const command: Command = {
  name: 'quit',
  aliases: ['q'],
  description: 'Exit application',
  parse() {
    return { type: 'quit' }
  },
}

export default command
