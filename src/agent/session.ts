import { join } from 'path'
import { homedir } from 'os'
import { mkdir, readdir, unlink } from 'fs/promises'
import { readJson, writeRaw } from '../utils/fs.js'
import type { MessageOrBoundary } from './compactBoundary.js'
import type { Message } from '../ui/App.js'

const SESSIONS_DIR = join(homedir(), '.deepseek', 'sessions')
const MAX_SESSIONS = 50

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
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < 12; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

export async function saveSession(data: SessionData): Promise<void> {
  try {
    await mkdir(SESSIONS_DIR, { recursive: true })
    const path = join(SESSIONS_DIR, `${data.id}.json`)
    await writeRaw(path, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }, null, 2))
    await pruneOldSessions()
  } catch {
    // Never crash on session save failure
  }
}

export async function loadSession(id: string): Promise<SessionData | null> {
  try {
    return await readJson<SessionData>(join(SESSIONS_DIR, `${id}.json`))
  } catch {
    return null
  }
}

export async function listSessions(): Promise<SessionData[]> {
  try {
    await mkdir(SESSIONS_DIR, { recursive: true })
    const files = await readdir(SESSIONS_DIR)
    const sessions = await Promise.all(
      files
        .filter((f) => f.endsWith('.json'))
        .map((f) => readJson<SessionData>(join(SESSIONS_DIR, f)).catch(() => null))
    )
    return (sessions.filter(Boolean) as SessionData[])
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  } catch {
    return []
  }
}

async function pruneOldSessions(): Promise<void> {
  try {
    const sessions = await listSessions()
    if (sessions.length <= MAX_SESSIONS) return
    const toDelete = sessions.slice(MAX_SESSIONS)
    await Promise.all(
      toDelete.map((s) => unlink(join(SESSIONS_DIR, `${s.id}.json`)).catch(() => {}))
    )
  } catch {}
}
