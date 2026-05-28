import type { Command } from '../types.js'

const command: Command = {
  name: 'models',
  aliases: [],
  description: 'Switch model interactively',
  parse() {
    return { type: 'models' }
  },
}

export default command
