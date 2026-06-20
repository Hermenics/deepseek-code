import { join } from 'path'
import { homedir } from 'os'
import { mkdir } from 'fs/promises'
import { readJson, writeJson } from '../utils/fs.js'

const HISTORY_PATH = join(homedir(), '.deepseek', 'input_history.json')
const MAX_ENTRIES = 200

export async function loadInputHistory(): Promise<string[]> {
  try {
    return await readJson<string[]>(HISTORY_PATH)
  } catch {
    return []
  }
}

export async function appendInputHistory(entry: string): Promise<void> {
  // Don't save commands (/) or shell shortcuts (!) to history
  const trimmed = entry.trim()
  if (trimmed.startsWith('/') || trimmed.startsWith('!')) return
  const history = await loadInputHistory()
  if (history[history.length - 1] === trimmed) return // no duplicates consecutivos
  history.push(trimmed)
  await mkdir(join(homedir(), '.deepseek'), { recursive: true })
  await writeJson(HISTORY_PATH, history.slice(-MAX_ENTRIES))
}
