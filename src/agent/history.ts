import { join } from 'path'
import { homedir } from 'os'
import { mkdir } from 'fs/promises'
import type { MessageOrBoundary } from './compactBoundary.js'
import { writeRaw } from '../utils/fs.js'

const HISTORY_PATH = join(homedir(), '.deepseek', 'history.json')
const MAX_HISTORY_MESSAGES = 500

export async function saveHistory(messages: MessageOrBoundary[]): Promise<void> {
  await mkdir(join(homedir(), '.deepseek'), { recursive: true })
  // Truncate to prevent unbounded growth — keep system prompt + last N messages
  const truncated = messages.length > MAX_HISTORY_MESSAGES
    ? [messages[0]!, ...messages.slice(-(MAX_HISTORY_MESSAGES - 1))]
    : messages
  await writeRaw(HISTORY_PATH, JSON.stringify(truncated, null, 2))
}
