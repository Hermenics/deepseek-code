import type { Command } from '../types.js'

const command: Command = {
  name: 'enchant-prompt',
  aliases: [],
  description: 'Toggle prompt enchantment (AI prompt refinement)',
  parse() {
    return { type: 'enchant-prompt' }
  },
}

export default command
