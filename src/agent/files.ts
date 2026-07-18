import fg from 'fast-glob'
import { readFile, realpath } from 'fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { resolveSafePath } from '../tools/shared/pathSafety.js'

const MAX_FILE_CHARS = 50_000  // ~12k tokens — prevent context explosion from large injected files

export async function resolveAgentFiles(patterns: string[], cwd = process.cwd()): Promise<string> {
  if (!patterns.length) return ''
  const root = resolve(cwd)
  for (const pattern of patterns) {
    if (!pattern || isAbsolute(pattern) || pattern.split(/[\\/]+/).includes('..')) {
      throw new Error(`Agent file pattern '${pattern}' must stay inside the project workspace`)
    }
  }

  const files = await fg(patterns, {
    cwd: root,
    ignore: ['**/node_modules/**', '**/.git/**', '**/.deepseek/**'],
    dot: true,
    absolute: true,
    onlyFiles: true,
    followSymbolicLinks: false,
  })

  const parts: string[] = []
  let remaining = MAX_FILE_CHARS
  const realRoot = await realpath(root)
  for (const file of files) {
    const safe = await resolveSafePath(file, {
      sessionId: 'agent-config', workspacePath: root, projectRoot: root, permissionProfile: 'researcher-readonly',
    })
    const canonical = await realpath(safe)
    const rel = relative(realRoot, canonical)
    if (rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Agent file '${file}' escapes the project workspace`)
    if (remaining <= 0) break
    const content = await readFile(canonical, 'utf-8')
    const body = content.slice(0, remaining)
    remaining -= body.length
    parts.push(`// File: ${rel}\n${body}${body.length < content.length ? `\n\n...(truncated — total agent file budget is ${MAX_FILE_CHARS} chars)` : ''}`)
  }

  return parts.join('\n\n')
}
