import { createHash, randomUUID } from 'node:crypto'
import { readFile, mkdir, stat, rm, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { acquireFileLease } from '../orchestration/fileLease.js'
import { redactSecrets } from '../orchestration/events.js'
import { renameReplacing, writeRaw } from '../utils/fs.js'
import { listSessions } from './session.js'
import { rankMemoryText } from './memorySearch.js'

interface ConversationMessage { role: 'user' | 'assistant'; content: string; index: number }
interface Episode { id: string; project: string; sessionId: string; createdAt: string; messages: ConversationMessage[]; truncated: boolean }
interface Archive { schemaVersion: 1; episodes: Episode[] }
export interface ConversationHit extends ConversationMessage {
  source: 'session' | 'compaction'
  sessionId: string
  reference: string
  createdAt: string
  title?: string
  truncated: boolean
}
const MAX_ARCHIVE_BYTES = 4_000_000
class InvalidConversationArchiveError extends Error {}

/** Only visible conversation text is retained: no system prompt, tool bodies, thinking or images. */
function visibleMessages(messages: readonly unknown[]): { messages: ConversationMessage[]; truncated: boolean } {
  const visible: ConversationMessage[] = []
  let remaining = 32_000
  let truncated = false
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index] as { role?: unknown; content?: unknown } | null
    if (!message || (message.role !== 'user' && message.role !== 'assistant') || typeof message.content !== 'string' || !message.content.trim()) continue
    if (remaining <= 0 || visible.length >= 100) { truncated = true; break }
    const text = String(redactSecrets(message.content))
    const content = text.slice(0, Math.min(remaining, 8000))
    truncated ||= content.length < text.length
    visible.push({ role: message.role, content, index })
    remaining -= content.length
  }
  return { messages: visible.reverse(), truncated }
}

async function readArchive(directory: string): Promise<Archive> {
  const file = join(directory, 'CONVERSATIONS.v1.json')
  try {
    if ((await stat(file)).size > MAX_ARCHIVE_BYTES) throw new InvalidConversationArchiveError('Conversation archive exceeds its 4 MB read limit.')
    const content = await readFile(file, 'utf8')
    let parsed: Archive
    try { parsed = JSON.parse(content) as Archive }
    catch (error) { if (error instanceof SyntaxError) throw new InvalidConversationArchiveError('Invalid conversation archive; refusing to overwrite it.'); throw error }
    if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.episodes) || parsed.episodes.length > 128 || parsed.episodes.some(episode =>
      !episode || typeof episode.id !== 'string' || typeof episode.project !== 'string' || typeof episode.sessionId !== 'string' ||
      typeof episode.createdAt !== 'string' || !Array.isArray(episode.messages) || episode.messages.some(message => !message ||
        !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !Number.isInteger(message.index)))) {
      throw new InvalidConversationArchiveError('Invalid conversation archive; refusing to overwrite it.')
    }
    return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, episodes: [] }
    throw error
  }
}

async function updateArchive(directory: string, update: (archive: Archive) => void, clearInvalid = false): Promise<void> {
  const lease = await acquireFileLease(`conversation-memory:${resolve(directory)}`, {})
  try {
    let archive: Archive
    try { archive = await readArchive(directory) }
    catch (error) {
      if (!clearInvalid || !(error instanceof InvalidConversationArchiveError)) throw error
      await rm(join(directory, 'CONVERSATIONS.v1.json'), { force: true })
      return
    }
    update(archive)
    while (archive.episodes.length > 128 || Buffer.byteLength(JSON.stringify(archive)) > MAX_ARCHIVE_BYTES) archive.episodes.shift()
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const file = join(directory, 'CONVERSATIONS.v1.json'), temporary = `${file}.${randomUUID()}.tmp`
    try { await writeRaw(temporary, JSON.stringify(archive)); await renameReplacing(temporary, file) }
    finally { await rm(temporary, { force: true }).catch(() => undefined) }
  } finally { await lease.release() }
}

async function projectKey(projectRoot: string): Promise<string> { return realpath(projectRoot).catch(() => resolve(projectRoot)) }

/** Preserve a bounded pre-compaction episode before the original messages leave active context. */
export async function captureConversation(directory: string, projectRoot: string, sessionId: string, messages: readonly unknown[]): Promise<void> {
  const visible = visibleMessages(messages)
  if (!visible.messages.length) return
  const project = await projectKey(projectRoot)
  const id = createHash('sha256').update(JSON.stringify({ project, sessionId, messages: visible.messages })).digest('hex')
  await updateArchive(directory, archive => {
    if (!archive.episodes.some(episode => episode.id === id)) archive.episodes.push({ id, project, sessionId, createdAt: new Date().toISOString(), ...visible })
  })
}

export async function clearConversationMemory(directory: string, projectRoot: string): Promise<void> {
  try { await stat(join(directory, 'CONVERSATIONS.v1.json')) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  const project = await projectKey(projectRoot)
  await updateArchive(directory, archive => { archive.episodes = archive.episodes.filter(episode => episode.project !== project) }, true)
}

async function conversationCorpus(directory: string, projectRoot: string, excludeSessionId?: string): Promise<ConversationHit[]> {
  const project = await projectKey(projectRoot)
  const result: ConversationHit[] = []
  const candidates = await listSessions(projectRoot)
  if (resolve(projectRoot) !== project) candidates.push(...await listSessions(project))
  const sessions = [...new Map(candidates.map(session => [session.id, session])).values()].slice(0, 100)
  for (const session of sessions) {
    if (session.id === excludeSessionId || !Array.isArray(session.uiMessages)) continue
    const visible = visibleMessages(session.uiMessages)
    const version = createHash('sha256').update(JSON.stringify(visible.messages)).digest('hex').slice(0, 16)
    for (const message of visible.messages) result.push({ ...message, source: 'session', sessionId: session.id,
      reference: `session:${session.id}:${version}:${message.index}`, createdAt: session.updatedAt, title: session.title, truncated: visible.truncated })
  }
  for (const episode of (await readArchive(directory)).episodes) {
    if (episode.project !== project) continue
    for (const message of episode.messages) result.push({ ...message, content: String(redactSecrets(message.content)), source: 'compaction',
      sessionId: episode.sessionId, reference: `compaction:${episode.id}:${message.index}`, createdAt: episode.createdAt, truncated: episode.truncated })
  }
  return result
}

export async function searchConversations(directory: string, projectRoot: string, query: string, limit = 8, excludeSessionId?: string): Promise<Array<ConversationHit & { score: number }>> {
  if (!query.trim() || query.length > 500 || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Session search requires a 1–500 character query and a limit of 1–20.')
  const corpus = await conversationCorpus(directory, projectRoot, excludeSessionId)
  return rankMemoryText(corpus, query, item => `${item.title ?? ''} ${item.content}`).slice(0, limit)
    .map(({ item, score }) => {
      const lower = item.content.toLowerCase(), word = query.toLowerCase().match(/[\p{L}\p{N}_]+/gu)?.find(term => lower.includes(term))
      const start = Math.max(0, word ? lower.indexOf(word) - 150 : 0)
      return { ...item, content: item.content.slice(start, start + 800), truncated: item.truncated || start > 0 || item.content.length > start + 800, score }
    })
}

export async function getConversationExcerpt(directory: string, projectRoot: string, reference: string): Promise<ConversationHit[]> {
  const corpus = await conversationCorpus(directory, projectRoot)
  const hit = corpus.find(item => item.reference === reference)
  if (!hit) throw new Error('Conversation reference not found in this project or no longer retained.')
  const prefix = reference.slice(0, reference.lastIndexOf(':'))
  const group = corpus.filter(item => item.reference.startsWith(`${prefix}:`))
  const position = group.findIndex(item => item.reference === reference)
  return group.slice(Math.max(0, position - 1), position + 2)
    .map(item => ({ ...item, content: item.content.slice(0, 2000), truncated: item.truncated || item.content.length > 2000 }))
}
