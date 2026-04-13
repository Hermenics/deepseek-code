import fg from 'fast-glob'
import { readFile } from 'fs/promises'

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
      parts.push(`// File: ${file}\n${content}`)
    } catch { /* skip unreadable files */ }
  }

  return parts.join('\n\n')
}
