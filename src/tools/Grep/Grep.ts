import { Tool } from '../types.js'
import { execa } from 'execa'
import * as path from 'node:path'
import { GREP_MAX_LINES } from '../../constants.js'
import { assertSafeDir } from '../shared/pathSafety.js'
import { ignoreDirNames, isPathIgnored } from '../shared/deepseekignore.js'

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
  async execute(args, context) {
    const dir = await assertSafeDir((args.path as string) || '.', context)
    const pattern = args.pattern as string
    const include = args.include as string | undefined
    const workspaceRoot = path.resolve(context?.workspacePath ?? process.cwd())

    const grepArgs = ['-rnzZ']
    if (include) grepArgs.push(`--include=${include}`)

    // Fast path: plain directory names from .deepseekignore (or defaults)
    // become --exclude-dir. Complex patterns are handled by the post-filter.
    for (const d of [...ignoreDirNames(workspaceRoot), '.DS_Store']) grepArgs.push(`--exclude-dir=${d}`)

    grepArgs.push('--', pattern, dir)

    try {
      const { stdout } = await execa('grep', grepArgs, { timeout: 15000, cancelSignal: context?.signal })
      const lines = stdout.split('\0').flatMap((part, index, parts) => {
        if (index % 2 !== 1) return []
        const file = parts[index - 1]!
        return part.split('\n').filter(Boolean)
          // Post-filter: drop matches in files .deepseekignore excludes.
          .filter(() => !isPathIgnored(path.resolve(file), workspaceRoot))
          .map((match) => `${file}:${match}`)
      })
      const truncated = lines.length > GREP_MAX_LINES
      const result = lines.slice(0, GREP_MAX_LINES).join('\n')
      return truncated
        ? `${result}\n\n(truncated — ${lines.length} results, showing first ${GREP_MAX_LINES})`
        : result || 'No matches'
    } catch (err: unknown) {
      const exitCode = (err as { exitCode?: number })?.exitCode
      if (exitCode === 1) return 'No matches'
      const msg = (err as { stderr?: string })?.stderr || 'Grep failed'
      return `Error: ${msg}`
    }
  },
}
