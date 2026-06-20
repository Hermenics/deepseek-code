import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG_DIR } from '../config.js'
import type { ChatMessage } from '../types/index.js'

const HISTORY_PATH = join(CONFIG_DIR, 'history.jsonl')

export function logHistory(model: string, conversationId: string, messages: ChatMessage[], response: string): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true })
  const entry = { timestamp: new Date().toISOString(), model, conversationId, messages, response }
  appendFileSync(HISTORY_PATH, JSON.stringify(entry) + '\n')
}
