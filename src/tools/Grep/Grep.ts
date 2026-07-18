import { Tool } from '../types.js'
import { execa } from 'execa'
import { GREP_MAX_LINES } from '../../constants.js'
import { assertSafeDir, BLOCKED_DIRS } from '../shared/pathSafety.js'

/** Directories to exclude from grep searches (BLOCKED_DIRS + common heavy dirs) */
const GREP_EXCLUDE_DIRS = [...new Set([
  ...BLOCKED_DIRS,
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.angular',
  '.cache',
  '.turbo',
  '.parcel-cache',
  '.yarn',
  '.pnpm-store',
  'bower_components',
  '.eslintcache',
  '.venv',
  'venv',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  'out',
  'tmp',
  '.tmp',
  'logs',
  'vendor',
  '.vscode',
  '.idea',
  '.DS_Store',
])]

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

    const grepArgs = ['-rn']
    if (include) grepArgs.push(`--include=${include}`)

    for (const d of GREP_EXCLUDE_DIRS) grepArgs.push(`--exclude-dir=${d}`)

    grepArgs.push('--', pattern, dir)

    try {
      const { stdout } = await execa('grep', grepArgs, { timeout: 15000, cancelSignal: context?.signal })
      const lines = stdout.split('\n').filter(Boolean)
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
