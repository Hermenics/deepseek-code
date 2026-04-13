import { Tool } from './types.js'
import { execaCommand } from 'execa'

export const Grep: Tool = {
  name: 'grep',
  description: 'Search for a regex pattern in files using grep.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern' },
      path: { type: 'string', description: 'Directory to search (default: .)' },
      include: { type: 'string', description: 'File glob filter, e.g. "*.ts"' },
    },
    required: ['pattern'],
  },
  async execute(args) {
    const dir = (args.path as string) || '.'
    const include = args.include ? `--include="${args.include}"` : ''
    const cmd = `grep -rn ${include} -- ${JSON.stringify(args.pattern as string)} ${JSON.stringify(dir)}`
    try {
      const { stdout } = await execaCommand(cmd, { shell: true, timeout: 15000 })
      const lines = stdout.split('\n')
      return lines.slice(0, 200).join('\n') || 'No matches'
    } catch {
      return 'No matches'
    }
  },
}
