import type { Command } from '../types.js'

/** `/config` (alias `/settings`): opens the fullscreen settings center. */
const command: Command = {
  name: 'config',
  aliases: ['settings'],
  description: 'Open the fullscreen settings center',
  parse() {
    return { type: 'config' }
  },
}

export default command
