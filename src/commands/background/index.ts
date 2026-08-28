import type { Command } from '../types.js'

export const BACKGROUND_WORKFLOW_SCRIPT = `export const meta = {"name":"background","description":"Run a prompt in the background"};
return agent(args.prompt);`

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
