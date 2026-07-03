import { join } from 'path'
import { homedir } from 'os'
import { mkdir, readFile, writeFile, unlink } from 'fs/promises'
import { randomBytes, createHash } from 'crypto'
import { readJson, writeJson } from '../utils/fs.js'

export interface FileCheckpointEntry {
  id: string
  timestamp: number
  path: string
  backupFile: string
  toolName: string
}

export interface FileCheckpointManifest {
  sessionId: string
  entries: FileCheckpointEntry[]
}

let currentSessionId: string | null = null

export function setCheckpointSession(id: string): void {
  currentSessionId = id
}

export function getCheckpointSession(): string | null {
  return currentSessionId
}

function getBaseDir(): string {
  return join(process.env.HOME || homedir(), '.deepseek-code', 'checkpoints')
}

function getSessionDir(sessionId: string): string {
  return join(getBaseDir(), sessionId)
}

function getFilesDir(sessionId: string): string {
  return join(getSessionDir(sessionId), 'files')
}

function getManifestPath(sessionId: string): string {
  return join(getSessionDir(sessionId), 'manifest.json')
}

function makeBackupName(filePath: string, timestamp: number): string {
  const hash = createHash('sha256')
    .update(`${filePath}:${timestamp}`)
    .digest('hex')
    .slice(0, 8)
  return `${hash}.bak`
}

async function loadManifest(sessionId: string): Promise<FileCheckpointManifest> {
  try {
    return await readJson<FileCheckpointManifest>(getManifestPath(sessionId))
  } catch {
    return { sessionId, entries: [] }
  }
}

async function saveManifest(manifest: FileCheckpointManifest): Promise<void> {
  await writeJson(getManifestPath(manifest.sessionId), manifest)
}

export async function createFileCheckpoint(
  sessionId: string,
  filePath: string,
  toolName: string,
): Promise<void> {
  const filesDir = getFilesDir(sessionId)
  await mkdir(filesDir, { recursive: true })

  const timestamp = Date.now()
  const backupFile = makeBackupName(filePath, timestamp)
  const id = `${timestamp}-${randomBytes(3).toString('hex')}`

  try {
    const content = await readFile(filePath, 'utf-8')
    await writeFile(join(filesDir, backupFile), content, 'utf-8')
  } catch {
    await writeFile(join(filesDir, backupFile), '', 'utf-8')
  }

  const manifest = await loadManifest(sessionId)
  manifest.entries.push({ id, timestamp, path: filePath, backupFile, toolName })
  await saveManifest(manifest)
}

export async function rollbackLast(sessionId: string): Promise<string> {
  const manifest = await loadManifest(sessionId)
  const entry = manifest.entries.pop()
  if (!entry) return 'Nothing to rollback.'

  const backupPath = join(getFilesDir(sessionId), entry.backupFile)
  try {
    const content = await readFile(backupPath, 'utf-8')
    if (content === '') {
      await unlink(entry.path).catch(() => {})
    } else {
      await writeFile(entry.path, content, 'utf-8')
    }
    await unlink(backupPath).catch(() => {})
  } catch (e) {
    return `Error restoring ${entry.path}: ${(e as Error).message}`
  }

  await saveManifest(manifest)
  return `Restored: ${entry.path}`
}

export async function rollbackAll(sessionId: string): Promise<string> {
  const manifest = await loadManifest(sessionId)
  if (manifest.entries.length === 0) return 'Nothing to rollback.'

  const restored: string[] = []
  const errors: string[] = []

  const entries = [...manifest.entries].reverse()
  for (const entry of entries) {
    const backupPath = join(getFilesDir(sessionId), entry.backupFile)
    try {
      const content = await readFile(backupPath, 'utf-8')
      if (content === '') {
        await unlink(entry.path).catch(() => {})
      } else {
        await writeFile(entry.path, content, 'utf-8')
      }
      await unlink(backupPath).catch(() => {})
      restored.push(entry.path)
    } catch (e) {
      errors.push(`${entry.path}: ${(e as Error).message}`)
    }
  }

  manifest.entries = []
  await saveManifest(manifest)

  const lines = [`Restored ${restored.length} file(s).`]
  if (errors.length) lines.push(`Errors: ${errors.join(', ')}`)
  return lines.join('\n')
}

export async function listFileCheckpoints(sessionId: string): Promise<FileCheckpointEntry[]> {
  const manifest = await loadManifest(sessionId)
  return [...manifest.entries].reverse()
}
