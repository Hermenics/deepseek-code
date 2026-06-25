import { createHash } from 'node:crypto'
import type { ChatMessage, CacheEntry } from '../types/index.js'

const cache = new Map<string, CacheEntry>()
const MAX_ENTRIES = 1000

function makeKey(model: string, messages: ChatMessage[]): string {
  return createHash('sha256').update(model + JSON.stringify(messages)).digest('hex')
}

export function getCached(model: string, messages: ChatMessage[], ttl: number): string | undefined {
  const entry = cache.get(makeKey(model, messages))
  if (!entry) return undefined
  if (Date.now() - entry.createdAt > ttl * 1000) {
    cache.delete(makeKey(model, messages))
    return undefined
  }
  return entry.response
}

export function setCache(model: string, messages: ChatMessage[], response: string): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) cache.delete(oldestKey)
  }
  cache.set(makeKey(model, messages), { response, model, createdAt: Date.now() })
}
