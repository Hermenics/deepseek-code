import { join } from 'path'
import { readFile } from 'fs/promises'

const STEERING_DIR = join(process.cwd(), '.deepseek', 'steering')

export async function loadSteering(): Promise<string> {
  const glob = new Bun.Glob('*.md')
  const parts: string[] = []

  try {
    for await (const file of glob.scan({ cwd: STEERING_DIR })) {
      const content = await readFile(join(STEERING_DIR, file), 'utf-8')
      parts.push(`--- ${file} ---\n${content.trim()}`)
    }
  } catch { /* dir doesn't exist */ }

  return parts.join('\n\n')
}
