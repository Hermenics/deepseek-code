import type { Command } from '../types.js'

const command: Command = {
  name: 'workflows', aliases: [], description: 'Monitor Dynamic Workflow runs',
  parse() { return { type: 'workflows' } },
}

export default command
