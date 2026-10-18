import { basename, dirname, isAbsolute, join } from 'path'
import { homedir } from 'os'
import { chmod, mkdir, open, readFile, unlink, lstat, stat, rename, rm } from 'fs/promises'
import { randomBytes, randomUUID, createHash } from 'crypto'
import { readJson } from '../utils/fs.js'
import type { FileVersion, ToolExecutionContext } from '../orchestration/types.js'
import { atomicDeleteFile, atomicWriteFile } from '../tools/shared/pathSafety.js'
import { acquireFileLease } from '../orchestration/fileLease.js'

export interface FileCheckpointEntry {
  id: string
  timestamp: number
  path: string
  backupFile: string
  toolName: string
  existed?: boolean
  backupHash?: string
  postExisted?: boolean
  postHash?: string
}

export interface FileCheckpointManifest {
  sessionId: string
  entries: FileCheckpointEntry[]
}

let currentSessionId: string | null = null

/** Sets the module-level session id that file-mutating tools use when recording checkpoints. */
export function setCheckpointSession(id: string): void {
  currentSessionId = id
}

/** Returns the session id set by setCheckpointSession, or null before a session is active. */
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

async function ensurePrivateDirectory(directory: string): Promise<void> {
  const missing: string[] = []
  let current = directory
  while (true) {
    try {
      await stat(current)
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      missing.push(current)
      const parent = dirname(current)
      if (parent === current) throw error
      current = parent
    }
  }

  for (const path of missing.reverse()) {
    try { await mkdir(path, { mode: 0o700 }) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    await syncDirectory(dirname(path))
  }

  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('checkpoint storage path is not a regular directory')
  if ((info.mode & 0o777) !== 0o700) {
    await chmod(directory, 0o700)
    await syncDirectory(directory)
  }
}

async function syncDirectory(directory: string): Promise<void> {
  // Node has no portable directory-fsync path on Windows; skip that durability step there.
  if (process.platform === 'win32') return
  const handle = await open(directory, 'r')
  try { await handle.sync() } finally { await handle.close() }
}

async function writeSyncedNewFile(path: string, contents: string): Promise<void> {
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function assertSessionId(sessionId: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(sessionId) || sessionId === '.' || sessionId === '..') throw new Error('invalid checkpoint session ID')
}

async function withManifestLease<T>(sessionId: string, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  assertSessionId(sessionId)
  const lease = await acquireFileLease(`checkpoint-manifest:${sessionId}`, { sessionId }, signal)
  try { return await operation() } finally { await lease.release() }
}

function validateManifest(value: unknown, sessionId: string): FileCheckpointManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('checkpoint manifest is malformed')
  const manifest = value as Partial<FileCheckpointManifest>
  if (manifest.sessionId !== sessionId) throw new Error('checkpoint manifest session ID mismatch')
  if (!Array.isArray(manifest.entries)) throw new Error('checkpoint manifest entries are malformed')
  for (const entry of manifest.entries) {
    if (!entry || typeof entry !== 'object' || !/^\d+-[0-9a-f]{16}$/.test(entry.id)
      || !Number.isFinite(entry.timestamp) || !isAbsolute(entry.path) || typeof entry.toolName !== 'string'
      || !entry.toolName || typeof entry.backupFile !== 'string' || basename(entry.backupFile) !== entry.backupFile
      || entry.backupFile !== `${entry.id}.bak`) throw new Error('checkpoint manifest entry is malformed')
    if (entry.existed !== undefined && typeof entry.existed !== 'boolean') throw new Error('checkpoint existence metadata is malformed')
    if (entry.backupHash !== undefined && !/^[0-9a-f]{64}$/.test(entry.backupHash)) throw new Error('checkpoint backup hash is malformed')
    if ((entry.postExisted === undefined) !== (entry.postHash === undefined)
      || (entry.postExisted !== undefined && typeof entry.postExisted !== 'boolean')
      || (entry.postHash !== undefined && !/^[0-9a-f]{64}$/.test(entry.postHash))) throw new Error('checkpoint post-write version is malformed')
  }
  return manifest as FileCheckpointManifest
}

/** Reads the session's checkpoint manifest, falling back to an empty one only when it is missing. */
async function loadManifest(sessionId: string): Promise<FileCheckpointManifest> {
  try {
    const path = getManifestPath(sessionId)
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('checkpoint manifest is not a regular file')
    return validateManifest(await readJson<unknown>(path), sessionId)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return { sessionId, entries: [] }
  }
}

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

async function saveManifest(manifest: FileCheckpointManifest): Promise<void> {
  await ensurePrivateDirectory(getBaseDir())
  const directory = getSessionDir(manifest.sessionId)
  await ensurePrivateDirectory(directory)
  const path = getManifestPath(manifest.sessionId)
  const temporary = join(directory, `.manifest-${randomUUID()}.tmp`)
  try {
    await writeSyncedNewFile(temporary, JSON.stringify(manifest, null, 2))
    await rename(temporary, path)
    await syncDirectory(directory)
  } finally {
    await unlink(temporary).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
  }
}

/**
 * Snapshots a file's current content before a tool modifies it and appends the entry to the session manifest.
 * Records whether the file existed, since an existing empty file differs from a missing file.
 */
export async function createFileCheckpoint(
  sessionId: string,
  filePath: string,
  toolName: string,
): Promise<string> {
  return withManifestLease(sessionId, async () => {
  const filesDir = getFilesDir(sessionId)
  await ensurePrivateDirectory(getBaseDir())
  await ensurePrivateDirectory(getSessionDir(sessionId))
  await ensurePrivateDirectory(filesDir)

  const timestamp = Date.now()
  const id = `${timestamp}-${randomBytes(8).toString('hex')}`
  const backupFile = `${id}.bak`

  let existed = true
  let content: string
  try { content = await readFile(filePath, 'utf-8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    existed = false
    content = ''
  }
  await writeSyncedNewFile(join(filesDir, backupFile), content)
  await syncDirectory(filesDir)

  const manifest = await loadManifest(sessionId)
  manifest.entries.push({ id, timestamp, path: filePath, backupFile, toolName, existed, backupHash: hash(content) })
  await saveManifest(manifest)
  return id
  })
}

/** Records the version produced by the write so rollback can preserve later user edits. */
export async function markFileCheckpointWritten(sessionId: string, id: string, version: FileVersion): Promise<void> {
  if (typeof version?.exists !== 'boolean' || !/^[0-9a-f]{64}$/.test(version.hash)) throw new Error('invalid checkpoint post-write version')
  await withManifestLease(sessionId, async () => {
  const manifest = await loadManifest(sessionId)
  const entry = manifest.entries.find(item => item.id === id)
  if (!entry) throw new Error('file checkpoint entry was not found before its post-write version could be saved')
  entry.postExisted = version.exists
  entry.postHash = version.hash
  await saveManifest(manifest)
  })
}

/** Remove a pre-write backup when the atomic write never committed. */
export async function discardFileCheckpoint(sessionId: string, id: string): Promise<void> {
  await withManifestLease(sessionId, async () => {
  const manifest = await loadManifest(sessionId)
  const index = manifest.entries.findIndex(item => item.id === id)
  if (index === -1) return
  const [entry] = manifest.entries.splice(index, 1)
  await saveManifest(manifest)
  await unlink(join(getFilesDir(sessionId), entry!.backupFile)).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  })
  })
}

async function restoreEntry(sessionId: string, entry: FileCheckpointEntry, context?: ToolExecutionContext): Promise<void> {
  if (!context) throw new Error('active path permission context is required to restore a checkpoint')
  if (context.signal?.aborted) throw context.signal.reason ?? new Error('checkpoint restore cancelled')
  if (entry.existed === undefined || !entry.backupHash) throw new Error('checkpoint predates safe existence metadata')
  if (entry.postExisted === undefined || !entry.postHash) throw new Error('checkpoint has no recorded post-write version')
  const backupPath = join(getFilesDir(sessionId), entry.backupFile)
  const backupInfo = await lstat(backupPath)
  if (!backupInfo.isFile() || backupInfo.isSymbolicLink()) throw new Error('checkpoint backup is not a regular file')
  const content = await readFile(backupPath, 'utf-8')
  if (entry.backupHash && hash(content) !== entry.backupHash) throw new Error('checkpoint backup hash mismatch')
  context.expectedFileVersion = { exists: entry.postExisted, hash: entry.postHash }
  if (entry.existed === false) {
    await atomicDeleteFile(entry.path, context)
  } else {
    await atomicWriteFile(entry.path, content, context)
  }
}

/** Restores the latest checkpoint only when the target still matches its recorded post-write version. */
export async function rollbackLast(sessionId: string, context?: ToolExecutionContext): Promise<string> {
  return withManifestLease(sessionId, async () => {
  const manifest = await loadManifest(sessionId)
  const entry = manifest.entries.at(-1)
  if (!entry) return 'Nothing to rollback.'

  const backupPath = join(getFilesDir(sessionId), entry.backupFile)
  try {
    await restoreEntry(sessionId, entry, context)
    manifest.entries.pop()
    await saveManifest(manifest)
    await unlink(backupPath).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
  } catch (e) {
    return `Error restoring ${entry.path}: ${(e as Error).message}`
  }

  return `Restored: ${entry.path}`
  }, context?.signal)
}

/** Restores every checkpointed file newest-first, clears the manifest and returns a human-readable summary. */
export async function rollbackAll(sessionId: string, context?: ToolExecutionContext): Promise<string> {
  return withManifestLease(sessionId, async () => {
  const manifest = await loadManifest(sessionId)
  if (manifest.entries.length === 0) return 'Nothing to rollback.'

  const restored: FileCheckpointEntry[] = []
  const errors: string[] = []

  const entries = [...manifest.entries].reverse()
  for (const entry of entries) {
    try {
      await restoreEntry(sessionId, entry, context)
      restored.push(entry)
    } catch (e) {
      errors.push(`${entry.path}: ${(e as Error).message}`)
    }
  }

  manifest.entries = manifest.entries.filter(entry => !restored.includes(entry))
  await saveManifest(manifest)
  for (const entry of restored) {
    await unlink(join(getFilesDir(sessionId), entry.backupFile)).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
  }

  const lines = [`Restored ${restored.length} file(s).`]
  if (errors.length) lines.push(`Errors: ${errors.join(', ')}`)
  return lines.join('\n')
  }, context?.signal)
}

/** Returns the session's checkpoint entries ordered newest first. */
export async function listFileCheckpoints(sessionId: string): Promise<FileCheckpointEntry[]> {
  return withManifestLease(sessionId, async () => {
    const manifest = await loadManifest(sessionId)
    return [...manifest.entries].reverse()
  })
}

/** Removes only one session's rollback data, failing closed for unsafe checkpoint paths. */
export async function deleteFileCheckpoints(sessionId: string): Promise<void> {
  return withManifestLease(sessionId, async () => {
    const appDirectory = dirname(getBaseDir())
    let appInfo
    try { appInfo = await lstat(appDirectory) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    if (!appInfo.isDirectory() || appInfo.isSymbolicLink()) throw new Error('checkpoint parent path is not a regular directory')

    let baseInfo
    try { baseInfo = await lstat(getBaseDir()) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    if (!baseInfo.isDirectory() || baseInfo.isSymbolicLink()) throw new Error('checkpoint storage path is not a regular directory')

    const sessionDirectory = getSessionDir(sessionId)
    let sessionInfo
    try { sessionInfo = await lstat(sessionDirectory) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    if (!sessionInfo.isDirectory() || sessionInfo.isSymbolicLink()) throw new Error('checkpoint session path is not a regular directory')

    await rm(sessionDirectory, { recursive: true })
  })
}
