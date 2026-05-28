import type { Command } from '../types.js'

const command: Command = {
  name: 'model',
  aliases: [],
  description: 'Set current model',
  parse(args) {
    const m = args[0]
    if (m) return { type: 'model', model: m }
    return { type: 'unknown', input: 'Usage: /model <model-name>' }
  },
}

export default command
