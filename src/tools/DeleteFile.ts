import { Tool } from './types.js'
import { rm } from 'fs/promises'

export const DeleteFile: Tool = {
  name: 'delete_file',
  description: 'Delete a file or directory (recursive).',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File or directory path to delete' },
    },
    required: ['path'],
  },
  async execute(args) {
    await rm(args.path as string, { recursive: true, force: true })
    return `Deleted: ${args.path}`
  },
}
