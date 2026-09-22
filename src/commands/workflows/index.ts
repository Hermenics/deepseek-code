import type { Command } from '../types.js'

/** `/workflows`: opens the monitor for Dynamic Workflow runs. */
const command: Command = {
  name: 'workflows', aliases: [], description: 'Monitor Dynamic Workflow runs',
  parse() { return { type: 'workflows' } },
}

export default command
