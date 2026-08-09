import type { Command } from '../types.js'

const command: Command = {
  name: 'system',
  aliases: [],
  description: 'Show active mode and permission summary',
  parse() {
    return { type: 'system' }
  },
}

export default command
