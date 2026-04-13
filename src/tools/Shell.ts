import { Tool } from './types.js'
import { execaCommand } from 'execa'

export const Shell: Tool = {
  name: 'shell',
  description: 'Run a shell command.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to run' },
      timeout: { type: 'number', description: 'Timeout in seconds (default: 30)' },
    },
    required: ['command'],
  },
  async execute(args) {
    const timeout = ((args.timeout as number) || 30) * 1000
    try {
      const { stdout, stderr } = await execaCommand(args.command as string, {
        shell: true,
        timeout,
      })
      const out = [stdout, stderr].filter(Boolean).join('\n')
      return out.slice(0, 50000) || '(no output)'
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; message?: string }
      return `Error: ${err.stderr || err.message || 'Command failed'}\n${err.stdout || ''}`.slice(0, 50000)
    }
  },
}
