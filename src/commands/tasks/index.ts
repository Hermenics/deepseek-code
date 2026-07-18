import type { Command } from '../types.js'

const command: Command = {
  name: 'tasks',
  aliases: [],
  description: 'Inspect the session task DAG',
  parse() { return { type: 'tasks' } },
}

export default command
