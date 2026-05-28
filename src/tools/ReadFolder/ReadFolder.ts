import { Tool } from '../types.js'
import * as fs from 'fs/promises'
import * as path from 'path'
import { assertSafeDir, BLOCKED_DIRS } from '../shared/pathSafety.js'

const EXCLUDE = new Set([...BLOCKED_DIRS, '.cache'])
const MAX_ENTRIES = 1000
const DEFAULT_MAX_DEPTH = 5

interface ListDirState {
  results: string[]
  truncated: boolean
}

async function listDir(
  dir: string,
  recursive: boolean,
  prefix: string,
  depth: number,
  state: ListDirState,
): Promise<void> {
  if (state.truncated) return

  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (e) {
    // Gracefully handle permission errors — skip unreadable dirs
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM') {
      state.results.push(prefix ? `${prefix}/ [permission denied]` : '[permission denied]')
      return
    }
    throw e
  }

  for (const e of entries) {
    if (state.truncated) return
    if (EXCLUDE.has(e.name)) continue

    const rel = prefix ? `${prefix}/${e.name}` : e.name
    state.results.push(e.isDirectory() ? `${rel}/` : rel)

    if (state.results.length >= MAX_ENTRIES) {
      state.truncated = true
      return
    }

    if (e.isDirectory() && recursive && depth > 0) {
      await listDir(path.join(dir, e.name), true, rel, depth - 1, state)
    }
  }
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

    const state: ListDirState = { results: [], truncated: false }
    await listDir(dirPath, !!args.recursive, '', DEFAULT_MAX_DEPTH, state)

    if (state.truncated) {
      return state.results.join('\n') + `\n\n[Truncated: exceeded ${MAX_ENTRIES} entries. Use a more specific path.]`
    }

    return state.results.join('\n') || '(empty directory)'
  },
}
