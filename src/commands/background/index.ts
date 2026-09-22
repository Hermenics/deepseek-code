import type { Command } from '../types.js'

/** Workflow script that runs the `/background` prompt as a single agent call inside the workflow runtime. */
export const BACKGROUND_WORKFLOW_SCRIPT = `export const meta = {"name":"background","description":"Run a prompt in the background"};
return agent(args.prompt);`

/** `/background <prompt>`: runs a prompt as a background workflow so the TUI stays usable. */
const command: Command = {
  name: 'background',
  aliases: [],
  description: 'Run a prompt in the background',
  parse(args) {
    const prompt = args.join(' ').trim()
    return prompt ? { type: 'background', prompt } : { type: 'unknown', input: 'Usage: /background <prompt>' }
  },
}

export default command
