import type { Command } from '../types.js'

const command: Command = {
  name: 'config',
  aliases: ['settings'],
  description: 'Open settings menu (theme, language, enchantment)',
  parse() {
    return { type: 'config' }
  },
}

export default command
