import { Tool } from '../types.js'
import * as fs from 'fs/promises'
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
  async execute(args) {
    const filePath = args.path as string
    const oldContent = args.old_content as string
    const newContent = args.new_content as string

    await assertSafePath(filePath)

    let source: string
    try {
      source = await fs.readFile(filePath, 'utf-8')
    } catch {
      return `Error: file not found: ${filePath}`
    }

    const count = source.split(oldContent).length - 1
    if (count === 0) return `Error: old_content not found in ${filePath}`
    if (count > 1) return `Error: old_content matches ${count} times — be more specific`

    // Use a function replacement to avoid special $ patterns in newContent being interpreted
    const updated = source.replace(oldContent, () => newContent)
    await fs.writeFile(filePath, updated, 'utf-8')

    const diff = computeDiff(source.split('\n'), updated.split('\n'))
    const added = diff.filter((l) => l.type === 'added').length
    const removed = diff.filter((l) => l.type === 'removed').length
    const firstChanged = diff.find((l) => l.type !== 'context')?.lineNo ?? 1

    return JSON.stringify({ __diff: true, path: filePath, added, removed, firstChanged, lines: diff })
  },
}
