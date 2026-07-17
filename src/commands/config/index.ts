import type { Command } from '../types.js'

const command: Command = {
  name: 'config',
  aliases: ['settings'],
  description: 'Open the fullscreen settings center',
  parse() {
    return { type: 'config' }
  },
}

export default command
