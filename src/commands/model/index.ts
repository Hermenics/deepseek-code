import type { Command } from '../types.js'

const command: Command = {
  name: 'model',
  aliases: [],
  description: 'Switch model (interactive or by name)',
  parse(args) {
    const m = args[0]
    if (m) return { type: 'model', model: m }
    return { type: 'models' }
  },
}

export default command
