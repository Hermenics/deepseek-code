import type { Command } from '../types.js'

/** `/model [name]`: switches to the named model, or opens the interactive model picker when no name is given. */
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
