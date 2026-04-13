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
      ignore: ['**/node_modules/**', '**/.git/**'],
      dot: true,
    })
    return files.slice(0, 500).join('\n') || 'No matches'
  },
}
