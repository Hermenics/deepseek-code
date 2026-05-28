import type { Command } from '../types.js'

const command: Command = {
  name: 'vim',
  aliases: [],
  description: 'Toggle vim keybindings',
  parse() {
    return { type: 'vim' }
  },
}

export default command
