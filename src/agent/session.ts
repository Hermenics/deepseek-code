import { join } from 'path'
import { homedir } from 'os'
import { mkdir, readdir, unlink, rm, writeFile } from 'fs/promises'
import { randomBytes } from 'crypto'
import { readJson, writeRaw } from '../utils/fs.js'
import type { MessageOrBoundary } from './compactBoundary.js'
import type { Message } from '../ui/App.js'
import { redactSecrets } from '../orchestration/events.js'

function getSessionsDir(): string {
  return join(process.env.HOME || homedir(), '.deepseek', 'sessions')
}
let maxSessions = 50

export function setSessionRetention(value: number): void {
  maxSessions = Math.max(1, Math.trunc(value))
}

export interface SessionData {
  id: string
  createdAt: string
  updatedAt: string
  cwd: string
  model: string
  provider: string
  language: string | null
  activeAgent: string | null
  agentMessages: MessageOrBoundary[]
  uiMessages: Message[]
  filesModified: string[]
}

export function newSessionId(): string {
  return randomBytes(6).toString('hex')
}

export async function saveSession(data: SessionData): Promise<void> {
  try {
    const dir = getSessionsDir()
    await mkdir(dir, { recursive: true })
    const path = join(dir, `${data.id}.json`)
    await writeRaw(path, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }, null, 2))
    await pruneOldSessions()
  } catch {
    // Never crash on session save failure
  }
}

export async function loadSession(id: string): Promise<SessionData | null> {
  try {
    return await readJson<SessionData>(join(getSessionsDir(), `${id}.json`))
  } catch {
    return null
  }
}

export async function listSessions(): Promise<SessionData[]> {
  try {
    const dir = getSessionsDir()
    await mkdir(dir, { recursive: true })
    const files = await readdir(dir)
    const sessions = await Promise.all(
      files
        .filter((f) => f.endsWith('.json'))
        .map((f) => readJson<SessionData>(join(dir, f)).catch(() => null))
    )
    return (sessions.filter(Boolean) as SessionData[])
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  } catch {
    return []
  }
}

async function pruneOldSessions(): Promise<void> {
  try {
    const dir = getSessionsDir()
    const sessions = await listSessions()
    if (sessions.length <= maxSessions) return
    const toDelete = sessions.slice(maxSessions)
    await Promise.all(
      toDelete.map((s) => unlink(join(dir, `${s.id}.json`)).catch(() => {}))
    )
  } catch {}
}

export async function clearSessions(scope: 'project' | 'global', cwd = process.cwd()): Promise<number> {
  const sessions = await listSessions()
  const selected = scope === 'global' ? sessions : sessions.filter(session => session.cwd === cwd)
  await Promise.all(selected.map(session => rm(join(getSessionsDir(), `${session.id}.json`), { force: true })))
  return selected.length
}

export async function getLastProjectSession(cwd = process.cwd()): Promise<SessionData | null> {
  return (await listSessions()).find(session => session.cwd === cwd) ?? null
}

export type SessionExportFormat = 'json' | 'md'
const SESSION_ID = /^[a-f0-9]{12}$/i

function formatExportMessage(message: Message): string {
  const title = message.role[0]!.toUpperCase() + message.role.slice(1)
  return `## ${title}\n\n${String(redactSecrets(message.content))}`
}

export function formatSessionExport(session: SessionData, format: SessionExportFormat): string {
  const sanitized = redactSecrets(session) as SessionData
  if (format === 'json') return `${JSON.stringify(sanitized, null, 2)}\n`
  return [
    '# DeepSeek Code session',
    '',
    `- ID: ${sanitized.id}`,
    `- Updated: ${sanitized.updatedAt}`,
    `- Workspace: ${sanitized.cwd}`,
    `- Provider/model: ${sanitized.provider} / ${sanitized.model}`,
    '',
    ...sanitized.uiMessages.map(formatExportMessage),
    '',
  ].join('\n')
}

export async function exportSession(id: string, format: SessionExportFormat, cwd = process.cwd()): Promise<string> {
  if (!SESSION_ID.test(id)) throw new Error('Invalid session ID.')
  const session = await loadSession(id)
  if (!session) throw new Error(`Session ${id} not found.`)
  const dir = join(cwd, '.deepseek')
  const path = join(dir, `session-${id}.sanitized.${format}`)
  await mkdir(dir, { recursive: true })
  await writeFile(path, formatSessionExport(session, format), { encoding: 'utf8', mode: 0o600 })
  return path
}
