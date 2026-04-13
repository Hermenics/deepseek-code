import { Tool } from './types.js'
import * as fs from 'fs/promises'
import * as path from 'path'

export const WriteFile: Tool = {
  name: 'write_file',
  description: 'Write content to a file. Creates parent directories if needed.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path' },
      content: { type: 'string', description: 'File content' },
    },
    required: ['path', 'content'],
  },
  async execute(args) {
    const filePath = args.path as string
    const content = args.content as string
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, 'utf-8')
    return `Wrote ${content.length} bytes to ${filePath}`
  },
}
