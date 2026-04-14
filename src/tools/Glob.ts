import { Tool } from './types.js'
import fg from 'fast-glob'

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
    return files.slice(0, 500).join('\n') || 'No matches'
  },
}
