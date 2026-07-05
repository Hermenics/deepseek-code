import * as fs from 'fs/promises'
import { Tool } from '../types.js'
import { assertSafePath } from '../shared/pathSafety.js'

interface LineEdit {
  line: number
  old: string[]
  new: string[]
}

function applyLineReplacements(lineContent: string, olds: string[], news: string[]): string | null {
  let cursor = 0
  const parts: string[] = []

  for (let i = 0; i < olds.length; i++) {
    const idx = lineContent.indexOf(olds[i], cursor)
    if (idx === -1) return null // not found
    parts.push(lineContent.slice(cursor, idx))
    parts.push(news[i])
    cursor = idx + olds[i].length
  }
  parts.push(lineContent.slice(cursor))
  return parts.join('')
}

export const EditFile: Tool = {
  name: 'edit_file',
  description:
    'Edit a file surgically by line number. Send only the line and the exact substrings to replace — far more token-efficient than write_file or patch_file for targeted changes. Supports multiple replacements per line and multiple lines per call.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to edit' },
      edits: {
        type: 'array',
        description: 'List of line edits',
        items: {
          type: 'object',
          properties: {
            line: { type: 'number', description: '1-indexed line number' },
            old: { type: 'array', items: { type: 'string' }, description: 'Substrings to find' },
            new: { type: 'array', items: { type: 'string' }, description: 'Replacement strings' },
          },
          required: ['line', 'old', 'new'],
        },
      },
    },
    required: ['path', 'edits'],
  },

  async execute(args): Promise<string> {
    const filePath = args.path as string
    const edits = args.edits as LineEdit[]

    await assertSafePath(filePath)

    let content: string
    try {
      content = await fs.readFile(filePath, 'utf-8')
    } catch {
      return JSON.stringify({ error: `File not found: ${filePath}` })
    }

    // Normalize: keep trailing newline state; split without losing empty last line
    const lines = content.split('\n')

    // Validate all edits before touching anything
    for (const edit of edits) {
      if (edit.old.length !== edit.new.length) {
        return JSON.stringify({ error: `Line ${edit.line}: old.length (${edit.old.length}) must equal new.length (${edit.new.length})` })
      }
      if (edit.line < 1 || edit.line > lines.length) {
        return JSON.stringify({ error: `Line ${edit.line} out of range (file has ${lines.length} lines)` })
      }
      const lineContent = lines[edit.line - 1]
      // Validate each old[n] exists using sequential search
      let cursor = 0
      for (let i = 0; i < edit.old.length; i++) {
        const idx = lineContent.indexOf(edit.old[i], cursor)
        if (idx === -1) {
          return JSON.stringify({
            error: `Line ${edit.line}: "${edit.old[i]}" not found (starting at position ${cursor}). Actual line: ${JSON.stringify(lineContent)}`,
          })
        }
        cursor = idx + edit.old[i].length
      }
    }

    // Reject duplicate line targets — multiple edits on the same line would conflict
    const lineNumbers = edits.map(e => e.line)
    const dupes = lineNumbers.filter((n, i) => lineNumbers.indexOf(n) !== i)
    if (dupes.length > 0) {
      return JSON.stringify({ error: `Duplicate line target(s): ${[...new Set(dupes)].join(', ')}. Combine all replacements for a line into a single edit entry.` })
    }

    // Sort edits bottom-to-top so line numbers remain valid as we splice
    const sorted = [...edits].sort((a, b) => b.line - a.line)
    const linesAffected: number[] = []

    for (const edit of sorted) {
      const idx = edit.line - 1
      const lineContent = lines[idx]
      const replaced = applyLineReplacements(lineContent, edit.old, edit.new)

      if (replaced === null) {
        return JSON.stringify({
          error: `Line ${edit.line}: replacement failed unexpectedly. Actual line: ${JSON.stringify(lineContent)}`,
        })
      }

      if (replaced.includes('\n')) {
        const subLines = replaced.split('\n')
        lines.splice(idx, 1, ...subLines)
      } else {
        lines[idx] = replaced
      }
      linesAffected.push(edit.line)
    }

    await fs.writeFile(filePath, lines.join('\n'), 'utf-8')

    return JSON.stringify({
      path: filePath,
      linesAffected: linesAffected.sort((a, b) => a - b),
      editCount: edits.length,
    })
  },
}
