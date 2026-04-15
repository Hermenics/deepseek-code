import { Tool } from './types.js'
import * as fs from 'fs/promises'

export const ReadFile: Tool = {
  name: 'read_file',
  description: 'Read file content. Optionally specify line range.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path' },
      start_line: { type: 'number', description: 'Start line (1-indexed)' },
      end_line: { type: 'number', description: 'End line (1-indexed)' },
    },
    required: ['path'],
  },
  async execute(args) {
    const filePath = args.path as string
    const content = await fs.readFile(filePath, 'utf-8')
    const lines = content.split('\n')
    const start = ((args.start_line as number) || 1) - 1
    const end = (args.end_line as number) || lines.length
    const slice = lines.slice(start, end)
    // Warn if file is very large but still return the requested range
    const prefix = lines.length > 10000 ? `[Warning: large file — ${lines.length} lines total. Showing lines ${start + 1}–${Math.min(end, lines.length)}]\n` : ''
    return prefix + slice.join('\n')
  },
}
