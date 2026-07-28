import { basename, join, resolve } from 'path'
import { homedir } from 'os'
import { mkdir, readdir, unlink, rm, writeFile } from 'fs/promises'
import { createHash, randomBytes } from 'crypto'
import { readJson, writeRaw } from '../utils/fs.js'
import type { MessageOrBoundary } from './compactBoundary.js'
import type { Message } from '../ui/App.js'
import { redactSecrets } from '../orchestration/events.js'

function resolvedCwd(cwd = process.cwd()): string {
  return resolve(cwd)
}

function readableProjectName(cwd = process.cwd()): string {
  return basename(resolvedCwd(cwd)).replace(/[^a-zA-Z0-9._-]/g, '-') || 'project'
}

function getSessionsDir(cwd = process.cwd()): string {
  const absoluteCwd = resolvedCwd(cwd)
  const hash = createHash('sha256').update(absoluteCwd).digest('hex').slice(0, 8)
  return join(process.env.HOME || homedir(), '.deepseek', 'sessions', `${readableProjectName(absoluteCwd)}-${hash}`)
}

function getPreviousProjectDir(cwd = process.cwd()): string {
  return join(process.env.HOME || homedir(), '.deepseek', 'sessions', readableProjectName(cwd))
}

function getLegacySessionsDir(): string {
  return join(process.env.HOME || homedir(), '.deepseek', 'sessions')
}

async function readSessionsDir(dir: string): Promise<SessionData[]> {
  try {
    const files = await readdir(dir)
    const sessions = await Promise.all(
      files
        .filter((f) => f.endsWith('.json'))
        .map((f) => readJson<SessionData>(join(dir, f)).catch(() => null))
    )
    return sessions.filter(Boolean) as SessionData[]
  } catch {
    return []
  }
}

function dedupeSessions(sessions: SessionData[]): SessionData[] {
  return [...new Map(sessions.map(session => [session.id, session])).values()]
}
let maxSessions = 50

export function setSessionRetention(value: number): void {
  maxSessions = Math.max(1, Math.trunc(value))
}

export interface SessionData {
  id: string
  title?: string
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

export async function updateSessionTitle(id: string, title: string, cwd = process.cwd()): Promise<void> {
  const session = await loadSession(id, cwd)
  if (session) await saveSession({ ...session, title })
}

export function newSessionId(): string {
  return randomBytes(6).toString('hex')
}

export async function saveSession(data: SessionData): Promise<void> {
  try {
    const dir = getSessionsDir(data.cwd)
    await mkdir(dir, { recursive: true })
    const path = join(dir, `${data.id}.json`)
    await writeRaw(path, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }, null, 2))
    await pruneOldSessions()
  } catch {
    // Never crash on session save failure
  }
}

export async function loadSession(id: string, cwd?: string): Promise<SessionData | null> {
  if (cwd) return (await listSessions(cwd)).find(session => session.id === id) ?? null
  const sessions = await listSessions()
  return sessions.find(session => session.id === id) ?? null
}

export async function listSessions(cwd?: string): Promise<SessionData[]> {
  try {
    if (cwd) {
      const requestedCwd = resolvedCwd(cwd)
      const sessions = [
        ...(await readSessionsDir(getSessionsDir(requestedCwd))),
        ...(await readSessionsDir(getPreviousProjectDir(requestedCwd))),
        ...(await readSessionsDir(getLegacySessionsDir())),
      ].filter(session => resolvedCwd(session.cwd) === requestedCwd)
      return dedupeSessions(sessions)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    }

    const root = join(process.env.HOME || homedir(), '.deepseek', 'sessions')
    await mkdir(root, { recursive: true })
    const entries = await readdir(root, { withFileTypes: true })
    const sessions = [
      ...(await readSessionsDir(getLegacySessionsDir())),
      ...(await Promise.all(entries.filter(entry => entry.isDirectory()).map(entry => readSessionsDir(join(root, entry.name))))).flat(),
    ]
    return dedupeSessions(sessions)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  } catch {
    return []
  }
}

async function pruneOldSessions(): Promise<void> {
  try {
    const sessions = await listSessions()
    if (sessions.length <= maxSessions) return
    const toDelete = sessions.slice(maxSessions)
    await Promise.all(
      toDelete.map((s) => Promise.all([
        unlink(join(getSessionsDir(s.cwd), `${s.id}.json`)).catch(() => {}),
        unlink(join(getPreviousProjectDir(s.cwd), `${s.id}.json`)).catch(() => {}),
        unlink(join(getLegacySessionsDir(), `${s.id}.json`)).catch(() => {}),
      ]))
    )
  } catch {}
}

export async function clearSessions(scope: 'project' | 'global', cwd = process.cwd()): Promise<number> {
  const selected = scope === 'global' ? await listSessions() : await listSessions(cwd)
  await Promise.all(selected.map(session => Promise.all([
    rm(join(getSessionsDir(session.cwd), `${session.id}.json`), { force: true }),
    rm(join(getPreviousProjectDir(session.cwd), `${session.id}.json`), { force: true }),
    rm(join(getLegacySessionsDir(), `${session.id}.json`), { force: true }),
  ])))
  return selected.length
}

export async function getLastProjectSession(cwd = process.cwd()): Promise<SessionData | null> {
  return (await listSessions(cwd))[0] ?? null
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
