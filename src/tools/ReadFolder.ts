import { Tool } from './types.js'
import * as fs from 'fs/promises'
import * as path from 'path'
import { assertSafeDir, BLOCKED_DIRS } from './pathSafety.js'

const EXCLUDE = new Set([...BLOCKED_DIRS, '.cache'])

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
    const dirPath = args.path as string
    await assertSafeDir(dirPath)
    const items = await listDir(dirPath, !!args.recursive)
    return items.join('\n') || '(empty directory)'
  },
}
