import type { Command } from '../types.js'

/** `/verify` (alias `/test`): runs the detected project test command after user confirmation. */
const command: Command = {
  name: 'verify',
  aliases: ['test'],
  description: 'Run the project test command after confirmation',
  parse() {
    return { type: 'verify' }
  },
}

export default command
