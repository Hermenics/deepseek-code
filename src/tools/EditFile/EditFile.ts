import * as fs from 'fs/promises'
import { createHash } from 'node:crypto'
import { Tool } from '../types.js'
import { assertExecutionActive, assertSafePath, atomicWriteFile } from '../shared/pathSafety.js'
import { applyTextEdits, readTextDocument } from '../shared/textEdits.js'

interface LineEdit {
  line: number
  old: string[]
  new: string[]
}
const POSITION_SCHEMA = { type: 'object', additionalProperties: false, properties: { line: { type: 'integer', minimum: 0 }, character: { type: 'integer', minimum: 0 } }, required: ['line', 'character'] }

/** Replace each `olds[i]` with `news[i]` in order, searching left to right from the end of the previous match; returns null if any substring is missing. */
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

/**
 * Numbered view of the edited lines (plus two lines of context) in their new positions, so a
 * follow-up edit uses current line numbers after a replacement that added lines.
 */
function previewEditedLines(lines: string[], originalLines: number[], spans: Map<number, number>, context = 2): string {
  const ranges: Array<[number, number]> = []
  let shift = 0
  for (const line of originalLines) {
    const span = spans.get(line) ?? 1
    const start = line - 1 + shift
    ranges.push([Math.max(0, start - context), Math.min(lines.length, start + span + context)])
    shift += span - 1
  }
  const shown: string[] = []
  let lastEnd = -1
  for (const [start, end] of ranges) {
    if (lastEnd >= 0 && start > lastEnd) shown.push('…')
    for (let i = Math.max(start, lastEnd); i < end; i++) shown.push(`${i + 1}  ${lines[i]}`)
    lastEnd = Math.max(lastEnd, end)
  }
  return shown.join('\n')
}

/** Tool for line-addressed substring replacements. Paths go through `assertSafePath`, and every edit is validated before an atomic write, so a bad edit changes nothing. */
export const EditFile: Tool = {
  name: 'edit_file',
  description:
    'Edit by line-numbered substring replacements (edits), or apply simultaneous UTF-16 ranges (text_edits) with a required expected_hash from a rename preview. Choose exactly one mode. Range edits refuse stale preview/read versions, overlap and invalid Unicode; read the file before applying and regenerate stale previews. Range writes are atomic per file, not across a workspace. New lines in uniformly CRLF range-edit documents use CRLF, reported in the result; other bytes/BOM and final newline state are preserved outside explicit edits. Legacy line edits support multiple replacements per line and normalize inserted newlines on CRLF-terminated lines.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to edit' },
      expected_hash: { type: 'string', pattern: '^[a-f0-9]{64}$', description: 'Required SHA-256 of the original UTF-8 bytes for text_edits. A stale proposal must be regenerated.' },
      text_edits: { type: 'array', minItems: 1, maxItems: 200, description: 'Version-bound simultaneous UTF-16 ranges from an LSP preview; use instead of edits.', items: { type: 'object', additionalProperties: false, properties: { range: { type: 'object', additionalProperties: false, properties: { start: POSITION_SCHEMA, end: POSITION_SCHEMA }, required: ['start', 'end'] }, newText: { type: 'string' } }, required: ['range', 'newText'] } },
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
    required: ['path'],
    oneOf: [{ required: ['edits'], not: { anyOf: [{ required: ['text_edits'] }, { required: ['expected_hash'] }] } }, { required: ['text_edits', 'expected_hash'], not: { required: ['edits'] } }],
  },

  async execute(args, context): Promise<string> {
    assertExecutionActive(context)
    if (args.expected_hash !== undefined && args.text_edits === undefined) throw new Error('expected_hash requires text_edits; choose the versioned range mode')
    const filePath = await assertSafePath(args.path as string, context)
    if (args.text_edits !== undefined) {
      if (!context) throw new Error('Versioned range edits require an execution context')
      if (args.edits !== undefined || typeof args.expected_hash !== 'string' || !/^[a-f0-9]{64}$/.test(args.expected_hash)) throw new Error('Choose one edit mode and provide a valid expected_hash for range edits')
      const snapshot = await readTextDocument(filePath, context)
      if (snapshot.path !== filePath) throw new Error('Range edits require the canonical file path returned by the preview')
      if (snapshot.hash !== args.expected_hash) throw new Error('File changed since the range proposal; regenerate the preview')
      if (context.expectedFileVersion && (!context.expectedFileVersion.exists || context.expectedFileVersion.hash !== args.expected_hash)) throw new Error('Range proposal does not match the version returned by the last read; read and regenerate it')
      const result = applyTextEdits(snapshot.text, args.text_edits)
      await atomicWriteFile(snapshot.path, result.content, { ...context, expectedFileVersion: { exists: true, hash: snapshot.hash } })
      return JSON.stringify({ path: snapshot.path, baseHash: snapshot.hash, editCount: result.edits.length, preview: result.preview, lineEndingNormalization: result.lineEndingNormalization })
    }
    const edits = args.edits as LineEdit[]

    let sourceBytes: Buffer
    try {
      sourceBytes = await fs.readFile(filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return JSON.stringify({ error: `File not found: ${filePath}` })
    }
    const content = sourceBytes.toString('utf-8')
    const expectedFileVersion = context?.expectedFileVersion ?? {
      exists: true,
      hash: createHash('sha256').update(sourceBytes).digest('hex'),
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
    const spans = new Map<number, number>()
    let normalizedReplacementLineEndings = false

    for (const edit of sorted) {
      const idx = edit.line - 1
      const lineContent = lines[idx]
      const replacements = lineContent.endsWith('\r') && idx < lines.length - 1
        ? edit.new.map(text => text.replace(/\r?\n/g, '\r\n')) : edit.new
      if (replacements.some((text, index) => text !== edit.new[index])) normalizedReplacementLineEndings = true
      const replaced = applyLineReplacements(lineContent, edit.old, replacements)

      if (replaced === null) {
        return JSON.stringify({
          error: `Line ${edit.line}: replacement failed unexpectedly. Actual line: ${JSON.stringify(lineContent)}`,
        })
      }

      if (replaced.includes('\n')) {
        const subLines = replaced.split('\n')
        lines.splice(idx, 1, ...subLines)
        spans.set(edit.line, subLines.length)
      } else {
        lines[idx] = replaced
        spans.set(edit.line, 1)
      }
      linesAffected.push(edit.line)
    }

    await atomicWriteFile(filePath, lines.join('\n'), context, expectedFileVersion)

    return JSON.stringify({
      path: filePath,
      linesAffected: linesAffected.sort((a, b) => a - b),
      editCount: edits.length,
      normalizedReplacementLineEndings,
      after: previewEditedLines(lines, linesAffected, spans),
    })
  },
}
