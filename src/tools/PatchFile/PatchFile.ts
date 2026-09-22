import { Tool } from '../types.js'
import * as fs from 'fs/promises'
import { assertExecutionActive, assertSafePath, atomicWriteFile } from '../shared/pathSafety.js'

type DiffLine = { type: 'added' | 'removed' | 'context'; text: string; lineNo: number }

/** LCS line diff rendered as +/-/context lines for the UI diff view. O(m*n) memory, so it returns [] when either side exceeds 5000 lines. */
function computeDiff(oldLines: string[], newLines: string[], _filePath?: string): DiffLine[] {
  // Guard: skip expensive diff for very large files to prevent OOM
  if (oldLines.length > 5000 || newLines.length > 5000) {
    return []
  }

  const m = oldLines.length, n = newLines.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i]![j] = oldLines[i] === newLines[j] ? 1 + dp[i + 1]![j + 1]! : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)

  const result: DiffLine[] = []
  let i = 0, j = 0
  while (i < m || j < n) {
    if (i < m && j < n && oldLines[i] === newLines[j]) {
      result.push({ type: 'context', text: ` ${oldLines[i]}`, lineNo: j + 1 }); i++; j++
    } else if (j < n && (i >= m || dp[i]![j + 1]! >= dp[i + 1]![j]!)) {
      result.push({ type: 'added', text: `+${newLines[j]}`, lineNo: j + 1 }); j++
    } else {
      result.push({ type: 'removed', text: `-${oldLines[i]}`, lineNo: i + 1 }); i++
    }
  }
  return result
}

/** Points the model at the likely target when old_content has no exact match. */
export function closestMatchHint(source: string, snippet: string): string {
  const wanted = snippet.split('\n').map((line) => line.trim()).filter(Boolean)
  if (wanted.length === 0) return ''
  const nonEmpty = source.split('\n').flatMap((line, i) => (line.trim() ? [{ line: i + 1, text: line.trim() }] : []))
  for (let i = 0; i + wanted.length <= nonEmpty.length; i++) {
    if (wanted.every((text, j) => nonEmpty[i + j]!.text === text)) {
      return ` — it matches at line ${nonEmpty[i]!.line} if whitespace is ignored; re-read that range with read_file and copy the text exactly, indentation included`
    }
  }
  const firstLine = nonEmpty.find((entry) => entry.text === wanted[0])
  if (firstLine) return ` — its first line appears at line ${firstLine.line} but the following lines differ; re-read that range with read_file`
  return ' — re-read the file with read_file; it may have changed since you last saw it'
}

/** Tool that replaces one exact, unique occurrence of `old_content`. Paths go through `assertSafePath`, CRLF files keep CRLF endings, and the write is atomic. Returns a diff payload. */
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
  async execute(args, context) {
    assertExecutionActive(context)
    const filePath = await assertSafePath(args.path as string, context)
    let oldContent = args.old_content as string
    let newContent = args.new_content as string

    let source: string
    try {
      source = await fs.readFile(filePath, 'utf-8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return `Error: file not found: ${filePath}`
    }

    // Models write LF; in a CRLF file convert the snippet to match, and always write CRLF so endings never mix.
    if (source.includes('\r\n')) {
      if (oldContent.includes('\n') && !oldContent.includes('\r\n')) oldContent = oldContent.replace(/\n/g, '\r\n')
      newContent = newContent.replace(/\r?\n/g, '\r\n')
    }

    const count = source.split(oldContent).length - 1
    if (count === 0) return `Error: old_content not found in ${filePath}${closestMatchHint(source, oldContent)}`
    if (count > 1) return `Error: old_content matches ${count} times — be more specific`

    // Use a function replacement to avoid special $ patterns in newContent being interpreted
    const updated = source.replace(oldContent, () => newContent)
    await atomicWriteFile(filePath, updated, context)

    const oldLines = source.split('\n')
    const newLines = updated.split('\n')
    const diff = computeDiff(oldLines, newLines)

    // Large file guard triggered — return summary instead of full diff
    if (diff.length === 0 && (oldLines.length > 5000 || newLines.length > 5000)) {
      return JSON.stringify({
        path: filePath,
        summary: `File too large for detailed diff (old: ${oldLines.length} lines, new: ${newLines.length} lines). Written successfully.`,
        linesAdded: newLines.length,
        linesRemoved: oldLines.length,
      })
    }

    const added = diff.filter((l) => l.type === 'added').length
    const removed = diff.filter((l) => l.type === 'removed').length
    const firstChanged = diff.find((l) => l.type !== 'context')?.lineNo ?? 1

    return JSON.stringify({ __diff: true, path: filePath, added, removed, firstChanged, lines: diff })
  },
}
