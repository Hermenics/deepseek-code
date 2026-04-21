import { join } from 'path'
import { homedir } from 'os'
import { mkdir } from 'fs/promises'
import type { MessageOrBoundary } from './compactBoundary.js'
import { readJson, writeRaw } from '../utils/fs.js'

const HISTORY_PATH = join(homedir(), '.deepseek', 'history.json')

export async function saveHistory(messages: MessageOrBoundary[]): Promise<void> {
  await mkdir(join(homedir(), '.deepseek'), { recursive: true })
  await writeRaw(HISTORY_PATH, JSON.stringify(messages, null, 2))
}

export async function loadHistory(): Promise<MessageOrBoundary[]> {
  try {
    return await readJson<MessageOrBoundary[]>(HISTORY_PATH)
  } catch {
    return []
  }
}
