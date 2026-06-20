import { Tool } from '../types.js'
import fg from 'fast-glob'
import { GLOB_MAX_FILES } from '../../constants.js'
import { assertSafeDir, BLOCKED_GLOB_PATTERNS } from '../shared/pathSafety.js'

// ── Glob ignore patterns — separated by category for clarity ──

/** Heavy directories not already covered by BLOCKED_GLOB_PATTERNS */
const GLOB_IGNORE_DIRS: string[] = [
  '**/target/**',
  '**/out/**',
  '**/.cache/**',
  '**/__pycache__/**',
  '**/.ipynb_checkpoints/**',
  '**/.vscode/**',
  '**/.idea/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.svelte-kit/**',
]

/** Lockfiles, binaries, media, and other non-source files */
const GLOB_IGNORE_FILES: string[] = [
  '**/*.map',
  '**/*.min.*',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/bun.lock',
  '**/*.{mp4,mov,avi,flv}',
  '**/*.{png,jpg,jpeg,gif,webp,ico,pdf}',
  '**/*.svg',
  '**/*.{zip,gz,tar,7z}',
  '**/*.log',
  '**/.env*',
  '**/.DS_Store',
]

/** All glob ignore patterns, deduplicated via Set */
export const GLOB_IGNORE_PATTERNS: string[] = [
  ...new Set([
    ...BLOCKED_GLOB_PATTERNS,
    ...GLOB_IGNORE_DIRS,
    ...GLOB_IGNORE_FILES,
  ]),
]

export const Glob: Tool = {
  name: 'glob',
  description: 'Find files matching a glob pattern.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern' },
      cwd: { type: 'string', description: 'Working directory (default: .)' },
    },
    required: ['pattern'],
  },
  async execute(args) {
    const cwd = (args.cwd as string) || '.'
    await assertSafeDir(cwd)

    const files = await fg(args.pattern as string, {
      cwd,
      ignore: GLOB_IGNORE_PATTERNS,
      dot: true,
    })
    if (!files.length) return 'No matches'
    const truncated = files.length > GLOB_MAX_FILES
    const result = files.slice(0, GLOB_MAX_FILES).join('\n')
    return truncated
      ? `${result}\n\n(truncated — ${files.length} files, showing first ${GLOB_MAX_FILES})`
      : result
  },
}
