import type { Command } from '../types.js'

const command: Command = {
  name: 'cost',
  aliases: [],
  description: 'Show estimated session cost',
  parse() {
    return { type: 'cost' }
  },
}

export default command
