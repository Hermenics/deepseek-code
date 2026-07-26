import type { Command } from '../types.js'

const command: Command = {
  name: 'doctor',
  aliases: [],
  description: 'Check runtime, workspace, credentials and MCP setup',
  parse() {
    return { type: 'doctor' }
  },
}

export default command
