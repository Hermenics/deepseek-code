import { Tool } from '../types.js'
import * as fs from 'fs/promises'
import * as path from 'path'
import { SHELL_OUTPUT_MAX_CHARS } from '../../constants.js'
import { assertSafePath } from '../shared/pathSafety.js'

type DiffLine = { type: 'added' | 'removed' | 'context'; text: string; lineNo: number }

function computeDiff(oldLines: string[], newLines: string[]): DiffLine[] {
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
  async execute(args) {
    const filePath = args.path as string
    const content = args.content as string

    await assertSafePath(filePath)

    let oldContent = ''
    try { oldContent = await fs.readFile(filePath, 'utf-8') } catch { /* new file */ }

    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, 'utf-8')

    const diff = computeDiff(oldContent.split('\n'), content.split('\n'))
    const added = diff.filter((l) => l.type === 'added').length
    const removed = diff.filter((l) => l.type === 'removed').length
    const firstChanged = diff.find((l) => l.type !== 'context')?.lineNo ?? 1

    return JSON.stringify({ __diff: true, path: filePath, added, removed, firstChanged, lines: diff })
  },
}
