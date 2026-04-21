import { Tool } from './types.js'
import { execa } from 'execa'
import { GREP_MAX_LINES } from '../constants.js'
import { assertSafeDir } from './pathSafety.js'

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

    await assertSafeDir(dir)

    const grepArgs = ['-rn']
    if (include) grepArgs.push(`--include=${include}`)
    grepArgs.push('--', pattern, dir)

    try {
      const { stdout } = await execa('grep', grepArgs, { timeout: 15000 })
      const lines = stdout.split('\n').filter(Boolean)
      const truncated = lines.length > GREP_MAX_LINES
      const result = lines.slice(0, GREP_MAX_LINES).join('\n')
      return truncated
        ? `${result}\n\n(truncated — ${lines.length} results, showing first ${GREP_MAX_LINES})`
        : result || 'No matches'
    } catch {
      return 'No matches'
    }
  },
}
