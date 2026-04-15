import { Tool } from './types.js'
import * as fs from 'fs/promises'

export const PatchFile: Tool = {
  name: 'patch_file',
  description:
    'Edit a file by replacing a specific string with new content. More efficient than write_file for targeted changes — only the changed section is sent. Fails if old_content is not found exactly once.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path' },
      old_content: { type: 'string', description: 'Exact string to find and replace' },
      new_content: { type: 'string', description: 'Replacement string' },
    },
    required: ['path', 'old_content', 'new_content'],
  },
  async execute(args) {
    const filePath = args.path as string
    const oldContent = args.old_content as string
    const newContent = args.new_content as string

    let source: string
    try {
      source = await fs.readFile(filePath, 'utf-8')
    } catch {
      return `Error: file not found: ${filePath}`
    }

    const count = source.split(oldContent).length - 1
    if (count === 0) return `Error: old_content not found in ${filePath}`
    if (count > 1) return `Error: old_content matches ${count} times — be more specific`

    const updated = source.replace(oldContent, newContent)
    await fs.writeFile(filePath, updated, 'utf-8')

    const addedLines = newContent.split('\n').length
    const removedLines = oldContent.split('\n').length
    return `Patched ${filePath} (+${addedLines - 1}/-${removedLines - 1} lines)`
  },
}
