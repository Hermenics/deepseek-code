import type { Command } from '../types.js'

/** `/doctor`: runs diagnostics on the runtime, workspace, credentials and MCP setup. */
const command: Command = {
  name: 'doctor',
  aliases: [],
  description: 'Check runtime, workspace, credentials and MCP setup',
  parse() {
    return { type: 'doctor' }
  },
}

export default command
