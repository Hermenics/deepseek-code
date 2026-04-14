import { join } from 'path'
import { homedir } from 'os'
import { mkdir } from 'fs/promises'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { readJson, writeRaw } from '../utils/fs.js'

const HISTORY_PATH = join(homedir(), '.deepseek', 'history.json')

export async function saveHistory(messages: ChatCompletionMessageParam[]): Promise<void> {
  await mkdir(join(homedir(), '.deepseek'), { recursive: true })
  await writeRaw(HISTORY_PATH, JSON.stringify(messages, null, 2))
}

export async function loadHistory(): Promise<ChatCompletionMessageParam[]> {
  try {
    return await readJson<ChatCompletionMessageParam[]>(HISTORY_PATH)
  } catch {
    return []
  }
}
