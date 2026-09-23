import { Tool } from '../types.js'
import * as fs from 'fs/promises'
import { assertSafePath } from '../shared/pathSafety.js'

const DEFAULT_MAX_LINES = 500

/** Read-only tool returning a line-numbered slice of a file (first 500 lines by default) with a header giving the total and how to continue. The path must pass `assertSafePath`. */
export const ReadFile: Tool = {
  name: 'read_file',
  description: `Read one or several files with line numbers. Pass path for one file or paths for several files in one call. Use it instead of shell cat/sed/head.
- Without start_line/end_line: returns the first ${DEFAULT_MAX_LINES} lines plus the total line count
- With start_line and/or end_line: returns exactly that range
- Read large files in chunks (e.g. start_line=${DEFAULT_MAX_LINES + 1}, end_line=${DEFAULT_MAX_LINES * 2}); read a file before editing it`,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path' },
      paths: { type: 'array', items: { type: 'string' }, description: 'File paths to read together; use instead of path' },
      start_line: { type: 'number', description: 'First line to read (1-indexed, inclusive). Defaults to 1.' },
      end_line: { type: 'number', description: 'Last line to read (1-indexed, inclusive). Defaults to start_line + 499.' },
    },
    anyOf: [{ required: ['path'] }, { required: ['paths'] }],
  },
  async execute(args, context) {
    const paths = args.paths
    if (paths !== undefined) {
      if (!Array.isArray(paths) || !paths.length || !paths.every(path => typeof path === 'string' && path.trim())) return 'Error: paths must be a non-empty array of file paths'
      return (await Promise.all(paths.map(path => ReadFile.execute({ ...args, path, paths: undefined }, context)))).join('\n\n')
    }
    if (typeof args.path !== 'string' || !args.path.trim()) return 'Error: path is required'
    const filePath = await assertSafePath(args.path, context)

    let content: string
    try {
      content = await fs.readFile(filePath, 'utf-8')
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'ENOENT') return `Error: file not found: ${filePath}`
      if (e.code === 'EACCES') return `Error: permission denied: ${filePath}`
      return `Error: could not read ${filePath}: ${e.message}`
    }

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
