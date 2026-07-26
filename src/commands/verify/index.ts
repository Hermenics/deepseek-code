import type { Command } from '../types.js'

const command: Command = {
  name: 'verify',
  aliases: ['test'],
  description: 'Run the project test command after confirmation',
  parse() {
    return { type: 'verify' }
  },
}

export default command
