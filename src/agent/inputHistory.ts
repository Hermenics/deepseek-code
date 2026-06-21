import { join } from 'path'
import { homedir } from 'os'
import { mkdir } from 'fs/promises'
import { readJson, writeJson } from '../utils/fs.js'

function getHistoryPath(): string {
  return join(process.env.HOME || homedir(), '.deepseek', 'input_history.json')
}
const MAX_ENTRIES = 200

export async function loadInputHistory(): Promise<string[]> {
  try {
    return await readJson<string[]>(getHistoryPath())
  } catch {
    return []
  }
}

export async function appendInputHistory(entry: string): Promise<void> {
  const trimmed = entry.trim()
  if (trimmed.startsWith('/') || trimmed.startsWith('!')) return
  const history = await loadInputHistory()
  if (history[history.length - 1] === trimmed) return
  history.push(trimmed)
  const historyPath = getHistoryPath()
  await mkdir(join(process.env.HOME || homedir(), '.deepseek'), { recursive: true })
  await writeJson(historyPath, history.slice(-MAX_ENTRIES))
}
