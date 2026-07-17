import { join } from 'path'
import { homedir } from 'os'
import { mkdir, readdir, unlink, rm } from 'fs/promises'
import { randomBytes } from 'crypto'
import { readJson, writeRaw } from '../utils/fs.js'
import type { MessageOrBoundary } from './compactBoundary.js'
import type { Message } from '../ui/App.js'

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
