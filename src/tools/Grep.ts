import { Tool } from './types.js'
import { execa } from 'execa'

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
    const pattern = args.pattern as string
    const include = args.include as string | undefined

    const grepArgs = ['-rn']
    if (include) grepArgs.push(`--include=${include}`)
    grepArgs.push('--', pattern, dir)

    try {
      const { stdout } = await execa('grep', grepArgs, { timeout: 15000 })
      const lines = stdout.split('\n')
      return lines.slice(0, 200).join('\n') || 'No matches'
    } catch {
      return 'No matches'
    }
  },
}
