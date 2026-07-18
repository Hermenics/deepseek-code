import { Tool } from '../types.js'
import * as fs from 'fs/promises'
import { assertExecutionActive, assertSafePath, atomicWriteFile } from '../shared/pathSafety.js'

type DiffLine = { type: 'added' | 'removed' | 'context'; text: string; lineNo: number }

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

export const WriteFile: Tool = {
  name: 'write_file',
  description: 'Write content to a file. Creates parent directories if needed.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path' },
      content: { type: 'string', description: 'File content' },
    },
    required: ['path', 'content'],
  },
  async execute(args, context) {
    assertExecutionActive(context)
    const filePath = await assertSafePath(args.path as string, context)
    const content = args.content as string

    let oldContent = ''
    try { oldContent = await fs.readFile(filePath, 'utf-8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    await atomicWriteFile(filePath, content, context)

    const oldLines = oldContent.split('\n')
    const newLines = content.split('\n')
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
