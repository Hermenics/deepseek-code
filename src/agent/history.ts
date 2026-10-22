import { dirname, join } from 'path'
import { homedir } from 'os'
import { mkdir, rename, rm, writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import type { MessageOrBoundary } from './compactBoundary.js'
import { redactSecrets } from '../orchestration/events.js'

const MAX_HISTORY_MESSAGES = 500

/** History file location; DEEPSEEK_HISTORY_PATH overrides the default `~/.deepseek/history.json`. */
function historyPath(): string {
  return process.env.DEEPSEEK_HISTORY_PATH?.trim() || join(homedir(), '.deepseek', 'history.json')
}

/** Writes the agent message history to disk, keeping the first (system) message plus the most recent messages up to MAX_HISTORY_MESSAGES. */
export async function saveHistory(messages: MessageOrBoundary[]): Promise<void> {
  const path = historyPath()
  await mkdir(dirname(path), { recursive: true })
  // Truncate to prevent unbounded growth — keep system prompt + last N messages
  const truncated = messages.length > MAX_HISTORY_MESSAGES
    ? [messages[0]!, ...messages.slice(-(MAX_HISTORY_MESSAGES - 1))]
    : messages
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(redactSecrets(truncated), null, 2), { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}
