import { Tool } from './types.js'
import * as fs from 'fs/promises'
import * as path from 'path'

const EXCLUDE = new Set(['node_modules', '.git', 'dist', 'build', '.cache'])

async function listDir(dir: string, recursive: boolean, prefix = ''): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const results: string[] = []
  for (const e of entries) {
    if (EXCLUDE.has(e.name)) continue
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    results.push(e.isDirectory() ? `${rel}/` : rel)
    if (e.isDirectory() && recursive) {
      results.push(...(await listDir(path.join(dir, e.name), true, rel)))
    }
  }
  return results
}

export const ReadFolder: Tool = {
  name: 'read_folder',
  description: 'List files and directories.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path' },
      recursive: { type: 'boolean', description: 'Recurse into subdirs' },
    },
    required: ['path'],
  },
  async execute(args) {
    const items = await listDir(args.path as string, !!args.recursive)
    return items.join('\n') || '(empty directory)'
  },
}
