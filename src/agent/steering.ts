import { join } from 'path'
import { readFile } from 'fs/promises'
import { globFiles } from '../utils/fs.js'

const STEERING_DIR = join(process.cwd(), '.deepseek', 'steering')

export async function loadSteering(): Promise<string> {
  const files = await globFiles(/\.md$/, STEERING_DIR)
  const parts: string[] = []
  for (const file of files) {
    try {
      const content = await readFile(join(STEERING_DIR, file), 'utf-8')
      parts.push(`--- ${file} ---\n${content.trim()}`)
    } catch { /* skip */ }
  }
  return parts.join('\n\n')
}
