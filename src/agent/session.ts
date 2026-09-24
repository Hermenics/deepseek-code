import { basename, join, resolve } from 'path'
import { homedir } from 'os'
import { mkdir, readdir, unlink, rm, writeFile } from 'fs/promises'
import { readFileSync, readdirSync } from 'fs'
import { createHash, randomBytes } from 'crypto'
import { readJson, writeRaw } from '../utils/fs.js'
import type { MessageOrBoundary } from './compactBoundary.js'
import type { Message } from '../ui/App.js'
import { redactSecrets } from '../orchestration/events.js'
import type { Goal } from './goal.js'

function resolvedCwd(cwd = process.cwd()): string {
  return resolve(cwd)
}

function readableProjectName(cwd = process.cwd()): string {
  return basename(resolvedCwd(cwd)).replace(/[^a-zA-Z0-9._-]/g, '-') || 'project'
}

/** Per-project session directory: `~/.deepseek/sessions/<name>-<hash8>`, keyed by the absolute cwd so same-named projects never collide. */
function getSessionsDir(cwd = process.cwd()): string {
  const absoluteCwd = resolvedCwd(cwd)
  const hash = createHash('sha256').update(absoluteCwd).digest('hex').slice(0, 8)
  return join(process.env.HOME || homedir(), '.deepseek', 'sessions', `${readableProjectName(absoluteCwd)}-${hash}`)
}

/** Older per-project layout (name only, no hash); still read and cleaned for backward compatibility. */
function getPreviousProjectDir(cwd = process.cwd()): string {
  return join(process.env.HOME || homedir(), '.deepseek', 'sessions', readableProjectName(cwd))
}

/** Oldest flat layout where all sessions lived directly in `~/.deepseek/sessions`. */
function getLegacySessionsDir(): string {
  return join(process.env.HOME || homedir(), '.deepseek', 'sessions')
}

/** Loads every parseable `*.json` session in a directory; unreadable files and a missing directory yield no entries. */
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

/** Drops duplicate session ids (the same session found in several layouts), keeping the last occurrence. */
function dedupeSessions(sessions: SessionData[]): SessionData[] {
  return [...new Map(sessions.map(session => [session.id, session])).values()]
}
let maxSessions = 50

/** Sets how many sessions are kept globally before the oldest are pruned (minimum 1). */
export function setSessionRetention(value: number): void {
  maxSessions = Math.max(1, Math.trunc(value))
}

export interface SessionData {
  id: string
  /** The source session when this transcript was created with /branch. */
  parentSessionId?: string
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
  goal?: Goal
}

/** Persist an independent transcript copy; the source object is never mutated. */
export async function createSessionBranch(source: SessionData, title?: string): Promise<SessionData> {
  const now = new Date().toISOString()
  const label = title?.trim() || source.title || source.uiMessages.find(message => message.role === 'user')?.content?.split('\n')[0] || 'session'
  const branch: SessionData = {
    ...structuredClone(source),
    id: newSessionId(),
    parentSessionId: source.id,
    title: `Branch of ${label}`.slice(0, 120),
    createdAt: now,
    updatedAt: now,
  }
  await saveSession(branch)
  return branch
}

/** Load and branch a persisted session, retaining the original session file. */
export async function branchSession(id: string, cwd = process.cwd(), title?: string): Promise<SessionData> {
  const source = await loadSession(id, cwd)
  if (!source) throw new Error(`Session ${id} not found.`)
  return createSessionBranch(source, title)
}

/** Renames a saved session; does nothing when the session does not exist. */
export async function updateSessionTitle(id: string, title: string, cwd = process.cwd()): Promise<void> {
  const session = await loadSession(id, cwd)
  if (session) await saveSession({ ...session, title })
}

/** Generates a 12-hex-char session id (the format exportSession validates). */
export function newSessionId(): string {
  return randomBytes(6).toString('hex')
}

/** Whether this session can actually be resumed, including after /cwd moves it to another project directory. */
function isResumableSessionFile(path: string, id: string): boolean {
  try {
    const session = JSON.parse(readFileSync(path, 'utf8')) as Partial<SessionData>
    return session !== null && typeof session === 'object'
      && session.id === id
      && typeof session.createdAt === 'string'
      && typeof session.updatedAt === 'string'
      && typeof session.cwd === 'string' && session.cwd.length > 0
      && typeof session.model === 'string' && session.model.length > 0
      && typeof session.provider === 'string' && session.provider.length > 0
      && Array.isArray(session.agentMessages)
      && Array.isArray(session.uiMessages)
      && Array.isArray(session.filesModified)
  } catch {
    return false
  }
}

export function hasSavedSession(id: string): boolean {
  if (!/^[a-f0-9]{12}$/i.test(id)) return false
  const root = getLegacySessionsDir()
  try {
    if (isResumableSessionFile(join(root, `${id}.json`), id)) return true
    return readdirSync(root, { withFileTypes: true })
      .some(entry => entry.isDirectory() && isResumableSessionFile(join(root, entry.name, `${id}.json`), id))
  } catch {
    return false
  }
}

/** Writes a session to its per-project directory with a fresh updatedAt and prunes old sessions. Failures are swallowed. */
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

/** Finds a session by id, searching only the given project's sessions when `cwd` is passed, otherwise all projects. */
export async function loadSession(id: string, cwd?: string): Promise<SessionData | null> {
  if (cwd) return (await listSessions(cwd)).find(session => session.id === id) ?? null
  const sessions = await listSessions()
  return sessions.find(session => session.id === id) ?? null
}

/**
 * Lists sessions newest first. With `cwd`, reads the current and both legacy layouts and keeps only sessions for that
 * directory; without it, returns sessions across every project. Never throws.
 */
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

/** Deletes sessions beyond the global retention limit (oldest by updatedAt) from all three directory layouts. Best-effort. */
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

/** Deletes all sessions for the current project, or every session when scope is `global`; returns how many were removed. */
export async function clearSessions(scope: 'project' | 'global', cwd = process.cwd()): Promise<number> {
  const selected = scope === 'global' ? await listSessions() : await listSessions(cwd)
  await Promise.all(selected.map(session => Promise.all([
    rm(join(getSessionsDir(session.cwd), `${session.id}.json`), { force: true }),
    rm(join(getPreviousProjectDir(session.cwd), `${session.id}.json`), { force: true }),
    rm(join(getLegacySessionsDir(), `${session.id}.json`), { force: true }),
  ])))
  return selected.length
}

/** Returns the most recently updated session for the project, or null. */
export async function getLastProjectSession(cwd = process.cwd()): Promise<SessionData | null> {
  return (await listSessions(cwd))[0] ?? null
}

export type SessionExportFormat = 'json' | 'md'
const SESSION_ID = /^[a-f0-9]{12}$/i

/** Renders one UI message as a Markdown section titled by its role, with secrets redacted. */
function formatExportMessage(message: Message): string {
  const title = message.role[0]!.toUpperCase() + message.role.slice(1)
  return `## ${title}\n\n${String(redactSecrets(message.content))}`
}

/** Serialises a secret-redacted session as pretty JSON or as a Markdown transcript of its UI messages. */
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

/** Writes a sanitised export of a session to `.deepseek/session-<id>.sanitized.<format>` (mode 0600) and returns the path. */
export async function exportSession(id: string, format: SessionExportFormat, cwd = process.cwd()): Promise<string> {
  if (!SESSION_ID.test(id)) throw new Error('Invalid session ID.')
  const session = await loadSession(id, cwd)
  if (!session) throw new Error(`Session ${id} not found.`)
  const dir = join(cwd, '.deepseek')
  const path = join(dir, `session-${id}.sanitized.${format}`)
  await mkdir(dir, { recursive: true })
  await writeFile(path, formatSessionExport(session, format), { encoding: 'utf8', mode: 0o600 })
  return path
}
