import type { Command } from '../types.js'

/** `/tasks`: shows the session's task DAG. */
const command: Command = {
  name: 'tasks',
  aliases: [],
  description: 'Inspect the session task DAG',
  parse() { return { type: 'tasks' } },
}

export default command
