import { Tool } from './types.js'
import fg from 'fast-glob'
import { GLOB_MAX_FILES } from '../constants.js'

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
    const files = await fg(args.pattern as string, {
      cwd: (args.cwd as string) || '.',
      ignore: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/build/**',
        '**/target/**',
        '**/out/**',
        '**/*.map',
        '**/*.min.*',
        '**/.cache/**',
        '**/__pycache__/**',
        '**/.ipynb_checkpoints/**',
        '**/package-lock.json',
        '**/yarn.lock',
        '**/pnpm-lock.yaml',
        '**/*.{mp4,mov,avi,flv}',
        '**/*.{png,jpg,jpeg,gif,webp,ico,pdf}',
        '**/*.svg',
        '**/*.{zip,gz,tar,7z}',
        '**/*.log',
        '**/.vscode/**',
        '**/.idea/**',
        '**/.env*',
        '**/.DS_Store',
        '**/bun.lock',
        '**/.next/**',
        '**/.nuxt/**',
        '**/.svelte-kit/**',
      ],
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
