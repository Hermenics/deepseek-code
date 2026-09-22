import type { Command } from '../types.js'

/** `/vim`: toggles vim keybindings in the input box. */
const command: Command = {
  name: 'vim',
  aliases: [],
  description: 'Toggle vim keybindings',
  parse() {
    return { type: 'vim' }
  },
}

export default command
