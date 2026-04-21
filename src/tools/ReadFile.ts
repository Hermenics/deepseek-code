import { Tool } from './types.js'
import * as fs from 'fs/promises'
import * as path from 'path'

const DEFAULT_MAX_LINES = 200

const BLOCKED_DIRS = [
  '.agent',
  '.claude',
  '.kiro',
  '.github',
  'node_modules',
  'dist',
  'build',
  '.git',
]

function assertSafePath(filePath: string): void {
  const resolved = path.resolve(filePath)
  const cwd = process.cwd()
  if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) {
    throw new Error(`Path '${filePath}' is outside the working directory`)
  }
  const relative = path.relative(cwd, resolved)
  const topDir = relative.split(path.sep)[0]
  if (topDir && BLOCKED_DIRS.includes(topDir)) {
    throw new Error(`Directory '${topDir}/' is off-limits. Focus on the project source code.`)
  }
}

export const ReadFile: Tool = {
  name: 'read_file',
  description: `Read file content with line numbers. Always shows line numbers so you can request specific ranges.
- Without start_line/end_line: returns first ${DEFAULT_MAX_LINES} lines with a summary of total lines
- With start_line and/or end_line: returns exactly that range
- Use line numbers to read large files in chunks (e.g. start_line=200, end_line=400)`,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path' },
      start_line: { type: 'number', description: 'First line to read (1-indexed, inclusive). Defaults to 1.' },
      end_line: { type: 'number', description: 'Last line to read (1-indexed, inclusive). Defaults to start_line + 199.' },
    },
    required: ['path'],
  },
  async execute(args) {
    const filePath = args.path as string
    assertSafePath(filePath)
    const content = await fs.readFile(filePath, 'utf-8')
    const lines = content.split('\n')
    const total = lines.length

    const startLine = (args.start_line as number | undefined) ?? 1
    const endLine = (args.end_line as number | undefined) ?? Math.min(startLine + DEFAULT_MAX_LINES - 1, total)

    const start0 = Math.max(0, startLine - 1)
    const end0 = Math.min(endLine, total)

    const slice = lines.slice(start0, end0)
    const width = String(end0).length

    const numbered = slice
      .map((line, i) => `${String(start0 + i + 1).padStart(width, ' ')}  ${line}`)
      .join('\n')

    const truncated = end0 < total
    const header = `[${filePath}  ${total} lines total  showing ${start0 + 1}–${end0}${truncated ? `  (${total - end0} more lines — use start_line=${end0 + 1} to continue)` : ''}]\n`

    return header + numbered
  },
}

