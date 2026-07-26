import { join } from 'path'
import { readFile } from 'fs/promises'
import { globFiles } from '../utils/fs.js'

export async function loadSteering(cwd = process.cwd()): Promise<string> {
  const steeringDir = join(cwd, '.deepseek', 'steering')
  const files = await globFiles(/\.md$/, steeringDir)
  const parts: string[] = []
  for (const file of files) {
    try {
      const content = await readFile(join(steeringDir, file), 'utf-8')
      parts.push(`--- ${file} ---\n${content.trim()}`)
    } catch { /* skip */ }
  }
  return parts.join('\n\n')
}

/**
 * Load DEEPSEEK.md from project root and/or .deepseek/ directory.
 * If both exist, concatenate them (root first).
 */
export async function loadDeepSeekMd(cwd = process.cwd()): Promise<string> {
  const paths = [
    join(cwd, 'DEEPSEEK.md'),
    join(cwd, '.deepseek', 'DEEPSEEK.md'),
  ]
  const parts: string[] = []
  for (const p of paths) {
    try {
      const content = await readFile(p, 'utf-8')
      if (content.trim()) parts.push(content.trim())
    } catch { /* file doesn't exist */ }
  }
  return parts.join('\n\n')
}

/**
 * Load the interoperable project instructions file used by coding agents.
 * DEEPSEEK.md remains DeepSeek-specific knowledge; AGENTS.md is user-authored
 * repository guidance shared with other CLIs.
 */
export async function loadAgentsMd(cwd = process.cwd()): Promise<string> {
  try {
    const content = await readFile(join(cwd, 'AGENTS.md'), 'utf-8')
    return content.trim()
  } catch {
    return ''
  }
}
