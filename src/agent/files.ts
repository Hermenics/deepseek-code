import fg from 'fast-glob'
import { readFile } from 'fs/promises'

const MAX_FILE_CHARS = 50_000  // ~12k tokens — prevent context explosion from large injected files

export async function resolveAgentFiles(patterns: string[]): Promise<string> {
  if (!patterns.length) return ''

  const files = await fg(patterns, {
    cwd: process.cwd(),
    ignore: ['**/node_modules/**', '**/.git/**'],
    dot: true,
    absolute: true,
  })

  const parts: string[] = []
  for (const file of files) {
    try {
      const content = await readFile(file, 'utf-8')
      const truncated = content.length > MAX_FILE_CHARS
      const body = truncated ? content.slice(0, MAX_FILE_CHARS) + `\n\n...(truncated — file exceeds ${MAX_FILE_CHARS} chars)` : content
      parts.push(`// File: ${file}\n${body}`)
    } catch { /* skip unreadable files */ }
  }

  return parts.join('\n\n')
}
