import { createHash, randomUUID } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { chmod, lstat, mkdir, opendir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import type { ShellStreamProvenance } from './streamCapture.js'
import { maskSecretsForOffsets } from '../../orchestration/events.js'
import { acquireFileLease } from '../../orchestration/fileLease.js'
import { safeGraphemeEnd, safeGraphemeStart } from '../../utils/textBoundaries.js'

const MAX_STORED_CHARS = 2_000_000
const MAX_SESSION_BYTES = 20 * 1024 * 1024
const MAX_SESSION_ARTIFACTS = 10
const MAX_SUPERVISOR_STATE_BYTES = 16 * 1024 * 1024
const MAX_SUPERVISOR_STATE_SCAN_BYTES = 32 * 1024 * 1024
const MAX_SUPERVISOR_STATE_FILES = 256
const MAX_READ_CHARS = 20_000
const OUTPUT_ARTIFACT_LEASE_WAIT_MS = 60_000
export const MAX_STORED_SHELL_OUTPUT_CHARS = MAX_STORED_CHARS
const ARTIFACT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface ShellOutputMetadata {
  totalChars: number
  storedChars: number
  truncated: boolean
  redacted?: boolean
  storage: 'disk' | 'recovery-disk' | 'emergency-disk' | 'memory'
  retentionWarning?: string
}

interface MemoryArtifact { directory: string; id: string; raw: string; bytes: number; createdAt: number }
const memoryArtifacts = new Map<string, MemoryArtifact>()

export function shellOutputDirectory(sessionId: string, storageRoot?: string): string {
  const sessionKey = createHash('sha256').update(sessionId).digest('hex')
  return join(storageRoot ?? process.env.HOME ?? homedir(), '.deepseek-code', 'shell-output', sessionKey)
}

function shellOutputRecoveryDirectory(sessionId: string, storageRoot?: string, recoveryRoot?: string): string {
  const sessionKey = createHash('sha256').update(sessionId).digest('hex')
  const root = recoveryRoot ?? (storageRoot
    ? join(dirname(storageRoot), `${basename(storageRoot) || 'shell-output'}-recovery`)
    : join(process.env.HOME ?? homedir(), '.deepseek', 'shell-output-recovery'))
  return join(root, sessionKey)
}

function shellOutputEmergencyRoot(emergencyRoot?: string): string {
  const userKey = typeof process.getuid === 'function'
    ? String(process.getuid())
    : createHash('sha256').update(homedir()).digest('hex').slice(0, 16)
  return emergencyRoot ?? join(tmpdir(), `deepseek-code-shell-output-${userKey}`)
}

export function shellOutputEmergencyDirectory(sessionId: string, emergencyRoot?: string): string {
  const sessionKey = createHash('sha256').update(sessionId).digest('hex')
  return join(shellOutputEmergencyRoot(emergencyRoot), sessionKey)
}

async function supervisorArtifactReferences(outputDirectory: string): Promise<Set<string> | undefined> {
  try {
    const outputInfo = await lstat(outputDirectory)
    if (!outputInfo.isDirectory() || outputInfo.isSymbolicLink()
      || typeof process.getuid === 'function' && outputInfo.uid !== process.getuid()) return undefined
    const stateDirectory = join(outputDirectory, 'supervisors')
    const stateInfo = await lstat(stateDirectory).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    })
    if (!stateInfo) return new Set()
    if (!stateInfo.isDirectory() || stateInfo.isSymbolicLink()
      || typeof process.getuid === 'function' && stateInfo.uid !== process.getuid()) return undefined

    const references = new Set<string>()
    let scannedBytes = 0
    let scannedFiles = 0
    const entries = await opendir(stateDirectory)
    for await (const entry of entries) {
      if (!/^[a-f0-9]{64}\.json$/i.test(entry.name)) continue
      if (++scannedFiles > MAX_SUPERVISOR_STATE_FILES) return undefined
      const path = join(stateDirectory, entry.name)
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink()
        || typeof process.getuid === 'function' && info.uid !== process.getuid()
        || info.size > MAX_SUPERVISOR_STATE_BYTES) return undefined
      scannedBytes += info.size
      if (scannedBytes > MAX_SUPERVISOR_STATE_SCAN_BYTES) return undefined
      const state = JSON.parse(await readFile(path, 'utf8')) as { schema?: unknown; outputId?: unknown; reservedOutputId?: unknown }
      if (state.schema !== 'shell_supervisor_v1') return undefined
      for (const id of [state.outputId, state.reservedOutputId]) {
        if (id === undefined) continue
        if (typeof id !== 'string' || !ARTIFACT_ID.test(id)) return undefined
        references.add(id)
      }
    }
    return references
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return new Set()
    return undefined
  }
}

async function prune(directory: string, keepId: string, protectedIds?: Set<string>): Promise<boolean> {
  const artifacts = await Promise.all((await readdir(directory))
    .filter(name => ARTIFACT_ID.test(name))
    .map(async id => ({ id, path: join(directory, id), info: await stat(join(directory, id)).catch(() => null) })))
  const files = artifacts.filter((item): item is typeof item & { info: Awaited<ReturnType<typeof stat>> } => item.info !== null)
    .sort((a, b) => a.info.mtimeMs - b.info.mtimeMs)
  let totalBytes = files.reduce((sum, file) => sum + file.info.size, 0)
  let count = files.length
  const cleanupErrors: NodeJS.ErrnoException[] = []
  for (const file of files) {
    if (count <= MAX_SESSION_ARTIFACTS && totalBytes <= MAX_SESSION_BYTES) break
    if (file.id === keepId || protectedIds === undefined || protectedIds.has(file.id)) continue
    try {
      await unlink(file.path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        cleanupErrors.push(error as NodeJS.ErrnoException)
        continue
      }
    }
    count--
    totalBytes -= file.info.size
  }
  if (cleanupErrors.length > 0) {
    const error = new Error(`Failed to remove ${cleanupErrors.length} shell output artifact(s) during cleanup`)
    Object.assign(error, { code: cleanupErrors[0]?.code })
    throw error
  }
  return count <= MAX_SESSION_ARTIFACTS && totalBytes <= MAX_SESSION_BYTES
}

async function tryWriteArtifact(directory: string, id: string, raw: string, protectedIds?: Set<string>): Promise<{ stored: boolean; error?: unknown; cleanupWarning?: string }> {
  try { await writeArtifact(directory, id, raw) }
  catch (error) { return { stored: false, error } }
  try {
    if (await prune(directory, id, protectedIds)) return { stored: true }
    try { await unlink(join(directory, id)) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return { stored: true, cleanupWarning: `retention cleanup ${(error as NodeJS.ErrnoException).code ?? 'failed'}` }
    }
    return { stored: false, error: Object.assign(new Error('Shell output retention quota is occupied by referenced artifacts'), { code: 'ENOSPC' }) }
  } catch (error) {
    return { stored: true, cleanupWarning: `cleanup ${(error as NodeJS.ErrnoException).code ?? 'failed'}` }
  }
}

function memoryKey(directory: string, id: string): string { return `${directory}\0${id}` }

function artifactChecksum(artifact: { totalChars: number; storedChars: number; truncated: boolean; redacted?: boolean; content: string; provenance?: ShellStreamProvenance }): string {
  return createHash('sha256').update(JSON.stringify({
    totalChars: artifact.totalChars, storedChars: artifact.storedChars, truncated: artifact.truncated,
    redacted: artifact.redacted === true, content: artifact.content, provenance: artifact.provenance ?? null,
  })).digest('hex')
}

function intactArtifact(raw: string): boolean {
  try {
    const artifact = JSON.parse(raw) as Record<string, unknown>
    if (typeof artifact.content !== 'string') return false
    if (artifact.contentHash === undefined) return artifact.schemaVersion !== 2
    if (!Number.isSafeInteger(artifact.totalChars) || !Number.isSafeInteger(artifact.storedChars) || typeof artifact.truncated !== 'boolean') return false
    return artifact.contentHash === artifactChecksum(artifact as Parameters<typeof artifactChecksum>[0])
  } catch { return false }
}

async function cacheMemoryArtifact(directory: string, id: string, metadata: Omit<ShellOutputMetadata, 'storage'>, content: string, provenance?: ShellStreamProvenance, protectedIds?: Set<string>): Promise<boolean> {
  const raw = JSON.stringify({ ...metadata, schemaVersion: 2, storage: 'memory', contentHash: artifactChecksum({ ...metadata, content, provenance }), content, ...(provenance ? { provenance } : {}) })
  const bytes = Buffer.byteLength(raw, 'utf8')
  if (bytes > MAX_SESSION_BYTES) return false
  const key = memoryKey(directory, id)
  const protectedByDirectory = new Map<string, Set<string> | undefined>([[directory, protectedIds]])
  for (const entry of memoryArtifacts.values()) {
    if (!protectedByDirectory.has(entry.directory)) {
      protectedByDirectory.set(entry.directory, await supervisorArtifactReferences(entry.directory))
    }
  }
  const pinned = [...memoryArtifacts.values()].filter(entry => {
    const references = protectedByDirectory.get(entry.directory)
    return references === undefined || references.has(entry.id)
  })
  if (pinned.length + 1 > MAX_SESSION_ARTIFACTS || pinned.reduce((sum, entry) => sum + entry.bytes, bytes) > MAX_SESSION_BYTES) return false

  memoryArtifacts.set(key, { directory, id, raw, bytes, createdAt: Date.now() })
  const entries = [...memoryArtifacts.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)
  let totalBytes = entries.reduce((sum, [, entry]) => sum + entry.bytes, 0)
  let count = entries.length
  for (const [entryKey, entry] of entries) {
    if (count <= MAX_SESSION_ARTIFACTS && totalBytes <= MAX_SESSION_BYTES) break
    const references = protectedByDirectory.get(entry.directory)
    if (entryKey === key || references === undefined || references.has(entry.id)) continue
    memoryArtifacts.delete(entryKey)
    count--
    totalBytes -= entry.bytes
  }
  if (count > MAX_SESSION_ARTIFACTS || totalBytes > MAX_SESSION_BYTES) memoryArtifacts.delete(key)
  return memoryArtifacts.has(key)
}

async function writeArtifact(directory: string, id: string, raw: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  if (!(await lstat(directory)).isDirectory()) throw new Error('shell output storage path is not a directory')
  await chmod(directory, 0o700)
  await writeFile(join(directory, id), raw, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
}

async function ensurePrivateEmergencyRoot(directory: string): Promise<void> {
  await mkdir(directory, { mode: 0o700 }).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  })
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink() || typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    throw new Error('Shell emergency output root is not an owned directory')
  }
  await chmod(directory, 0o700)
}

async function persistEmergencyArtifact(
  directory: string, id: string, metadata: Omit<ShellOutputMetadata, 'storage' | 'retentionWarning'>,
  content: string, provenance: ShellStreamProvenance | undefined, warning: string, protectedIds?: Set<string>,
): Promise<{ retained: boolean; warning: string }> {
  const contentHash = artifactChecksum({ ...metadata, content, provenance })
  const raw = JSON.stringify({ ...metadata, schemaVersion: 2, storage: 'emergency-disk', contentHash, retentionWarning: warning, content, ...(provenance ? { provenance } : {}) })
  try { await ensurePrivateEmergencyRoot(dirname(directory)) }
  catch (error) { return { retained: false, warning: `${warning}; emergency storage failed (${(error as NodeJS.ErrnoException).code ?? 'failed'})` } }
  const result = await tryWriteArtifact(directory, id, raw, protectedIds)
  if (!result.stored) return { retained: false, warning: `${warning}; emergency storage failed (${(result.error as NodeJS.ErrnoException)?.code ?? 'failed'})` }
  if (result.cleanupWarning) warning += `; emergency ${result.cleanupWarning}`
  return { retained: true, warning }
}

async function readArtifactFrom(primaryDirectory: string, recoveryDirectory: string, emergencyDirectory: string, id: string): Promise<string> {
  const memory = memoryArtifacts.get(memoryKey(primaryDirectory, id))
  if (memory) {
    if (intactArtifact(memory.raw)) return memory.raw
    memoryArtifacts.delete(memoryKey(primaryDirectory, id))
  }
  let primaryError: unknown
  try {
    const raw = await readFile(join(primaryDirectory, id), 'utf8')
    if (intactArtifact(raw)) return raw
    primaryError = new Error('Shell output artifact integrity check failed')
  } catch (error) { primaryError = error }
  try {
    const raw = await readFile(join(recoveryDirectory, id), 'utf8')
    if (intactArtifact(raw)) return raw
    throw new Error('Shell output artifact integrity check failed')
  } catch { /* Continue to the emergency directory before reporting primary failure. */ }
  try {
    const raw = await readFile(join(emergencyDirectory, id), 'utf8')
    if (intactArtifact(raw)) return raw
    throw new Error('Shell output artifact integrity check failed')
  } catch { throw primaryError }
}

/** Persist a bounded private copy, masking known secrets without shifting provenance offsets. */
type SaveShellOutput = (content: string, totalChars?: number, provenance?: ShellStreamProvenance, recoveryRoot?: string, emergencyRoot?: string, artifactId?: string) => Promise<{ id: string; metadata: ShellOutputMetadata }>

/** Hold the same local-host lease while publishing a supervisor reservation and saving its artifact. */
export async function withShellOutputArtifactLease<T>(sessionId: string, storageRoot: string | undefined, operation: (save: SaveShellOutput) => Promise<T>): Promise<T> {
  const directory = shellOutputDirectory(sessionId, storageRoot)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('Timed out waiting for the shell output artifact lease')), OUTPUT_ARTIFACT_LEASE_WAIT_MS)
  let lease: Awaited<ReturnType<typeof acquireFileLease>>
  try {
    // A reused live PID can make an abandoned lease appear owned forever; fail closed after a bounded wait.
    lease = await acquireFileLease(`shell-output-artifacts:${resolve(directory)}`, {}, controller.signal)
    if (controller.signal.aborted) {
      await lease.release()
      throw controller.signal.reason
    }
  } finally {
    clearTimeout(timeout)
  }
  try {
    return await operation((content, totalChars, provenance, recoveryRoot, emergencyRoot, artifactId) =>
      saveShellOutputUnderLease(sessionId, content, totalChars, storageRoot, provenance, recoveryRoot, emergencyRoot, artifactId))
  } finally {
    await lease.release()
  }
}

async function saveShellOutputUnderLease(sessionId: string, content: string, totalChars = content.length, storageRoot?: string, provenance?: ShellStreamProvenance, recoveryRoot?: string, emergencyRoot?: string, artifactId: string = randomUUID()): Promise<{ id: string; metadata: ShellOutputMetadata }> {
  if (!ARTIFACT_ID.test(artifactId)) throw new Error('Invalid shell output ID')
  const directory = shellOutputDirectory(sessionId, storageRoot)
  const recoveryDirectory = shellOutputRecoveryDirectory(sessionId, storageRoot, recoveryRoot)
  const emergencyDirectory = shellOutputEmergencyDirectory(sessionId, emergencyRoot)
  const protectedIds = await supervisorArtifactReferences(directory)
  const id = artifactId
  const masked = maskSecretsForOffsets(content)
  const storedChars = safeGraphemeEnd(masked, MAX_STORED_CHARS)
  const baseMetadata = { totalChars, storedChars, truncated: storedChars < totalChars, redacted: masked !== content }
  const artifactContent = masked.slice(0, storedChars)
  const contentHash = artifactChecksum({ ...baseMetadata, content: artifactContent, provenance })
  const raw = JSON.stringify({ ...baseMetadata, schemaVersion: 2, storage: 'disk', contentHash, content: artifactContent, ...(provenance ? { provenance } : {}) })
  const primary = await tryWriteArtifact(directory, id, raw, protectedIds)
  if (!primary.stored) {
    const primaryError = primary.error
    const primaryWarning = `primary storage failed (${(primaryError as NodeJS.ErrnoException)?.code ?? 'failed'})`
    if (recoveryDirectory !== directory) {
      const recoveryRaw = JSON.stringify({ ...baseMetadata, schemaVersion: 2, storage: 'recovery-disk', contentHash, retentionWarning: primaryWarning, content: artifactContent, ...(provenance ? { provenance } : {}) })
      const recovery = await tryWriteArtifact(recoveryDirectory, id, recoveryRaw, protectedIds)
      if (recovery.stored) {
        let retentionWarning = primaryWarning
        if (recovery.cleanupWarning) retentionWarning += `; recovery ${recovery.cleanupWarning}`
        if (emergencyDirectory !== directory && emergencyDirectory !== recoveryDirectory) {
          const emergency = await persistEmergencyArtifact(emergencyDirectory, id, baseMetadata, artifactContent, provenance, `${primaryWarning}; emergency mirror`, protectedIds)
          retentionWarning += emergency.retained ? '; emergency copy retained' : `; ${emergency.warning}`
        }
        return { id, metadata: { ...baseMetadata, storage: 'recovery-disk', retentionWarning } }
      }
      const recoveryWarning = `recovery storage failed (${(recovery.error as NodeJS.ErrnoException)?.code ?? 'failed'})`
      if (emergencyDirectory !== directory && emergencyDirectory !== recoveryDirectory) {
        const emergency = await persistEmergencyArtifact(emergencyDirectory, id, baseMetadata, artifactContent, provenance, `${primaryWarning}; ${recoveryWarning}`, protectedIds)
        if (emergency.retained) return { id, metadata: { ...baseMetadata, storage: 'emergency-disk', retentionWarning: emergency.warning } }
        const metadata = { ...baseMetadata, storage: 'memory' as const, retentionWarning: emergency.warning }
        if (await cacheMemoryArtifact(directory, id, baseMetadata, artifactContent, provenance, protectedIds)) return { id, metadata }
        throw primaryError
      }
    }
    const emergency = emergencyDirectory !== directory && emergencyDirectory !== recoveryDirectory
      ? await persistEmergencyArtifact(emergencyDirectory, id, baseMetadata, artifactContent, provenance, primaryWarning, protectedIds)
      : null
    if (emergency?.retained) return { id, metadata: { ...baseMetadata, storage: 'emergency-disk', retentionWarning: emergency.warning } }
    const metadata = { ...baseMetadata, storage: 'memory' as const, retentionWarning: emergency?.warning ?? primaryWarning }
    if (await cacheMemoryArtifact(directory, id, baseMetadata, artifactContent, provenance, protectedIds)) return { id, metadata }
    throw primaryError
  }
  let retentionWarning: string | undefined
  if (recoveryDirectory !== directory) {
    const recoveryRaw = JSON.stringify({ ...baseMetadata, schemaVersion: 2, storage: 'recovery-disk', contentHash, content: artifactContent, ...(provenance ? { provenance } : {}) })
    const recovery = await tryWriteArtifact(recoveryDirectory, id, recoveryRaw, protectedIds)
    if (recovery.stored) {
      if (recovery.cleanupWarning) retentionWarning = `recovery ${recovery.cleanupWarning}`
    } else {
      const recoveryWarning = `recovery copy failed (${(recovery.error as NodeJS.ErrnoException)?.code ?? 'failed'})`
      if (emergencyDirectory !== directory && emergencyDirectory !== recoveryDirectory) {
        const emergency = await persistEmergencyArtifact(emergencyDirectory, id, baseMetadata, artifactContent, provenance, recoveryWarning, protectedIds)
        retentionWarning = emergency.retained ? `${recoveryWarning}; emergency copy retained` : emergency.warning
      } else retentionWarning = recoveryWarning
    }
  }
  if (primary.cleanupWarning) retentionWarning = [retentionWarning, `primary ${primary.cleanupWarning}`].filter(Boolean).join('; ')
  return { id, metadata: { ...baseMetadata, storage: 'disk', ...(retentionWarning ? { retentionWarning } : {}) } }
}

export async function saveShellOutput(sessionId: string, content: string, totalChars = content.length, storageRoot?: string, provenance?: ShellStreamProvenance, recoveryRoot?: string, emergencyRoot?: string, artifactId: string = randomUUID()): Promise<{ id: string; metadata: ShellOutputMetadata }> {
  return withShellOutputArtifactLease(sessionId, storageRoot, save => save(content, totalChars, provenance, recoveryRoot, emergencyRoot, artifactId))
}

/** Read bounded channel/offset provenance from an output_id without changing the legacy text read response. */
export async function readShellOutputProvenance(sessionId: string, id: string, startSegment = 0, storageRoot?: string, recoveryRoot?: string, emergencyRoot?: string): Promise<string> {
  if (!ARTIFACT_ID.test(id)) return JSON.stringify({ error: 'invalid shell output ID' })
  if (!Number.isSafeInteger(startSegment) || startSegment < 0) return JSON.stringify({ error: 'provenance_start must be a non-negative integer' })
  try {
    const raw = await readArtifactFrom(shellOutputDirectory(sessionId, storageRoot), shellOutputRecoveryDirectory(sessionId, storageRoot, recoveryRoot), shellOutputEmergencyDirectory(sessionId, emergencyRoot), id)
    const artifact = JSON.parse(raw) as { provenance?: ShellStreamProvenance; redacted?: boolean; content?: string; storage?: ShellOutputMetadata['storage'] }
    const provenance = artifact.provenance
    if (!provenance || provenance.schema !== 'shell_channel_provenance_v1' || provenance.ordering !== 'observed-arrival' || !Array.isArray(provenance.segments)) {
      return JSON.stringify({ error: 'shell output provenance is unavailable' })
    }
    if (startSegment > provenance.segments.length) return JSON.stringify({ error: `provenance_start exceeds retained segment count (${provenance.segments.length})` })
    const base = {
      schema: provenance.schema,
      ordering: provenance.ordering,
      stdoutChars: provenance.stdoutChars,
      stderrChars: provenance.stderrChars,
      retainedChars: provenance.retainedChars,
      totalSegments: provenance.segments.length,
      segmentsOmitted: provenance.segmentsOmitted,
      contentOmitted: provenance.contentOmitted,
      drainTimedOut: provenance.drainTimedOut,
      storage: artifact.storage ?? 'disk',
      contentRedacted: artifact.redacted === true || (typeof artifact.content === 'string' && maskSecretsForOffsets(artifact.content) !== artifact.content),
    }
    let count = Math.min(128, provenance.segments.length - startSegment)
    let response = ''
    while (count >= 0) {
      const next = startSegment + count < provenance.segments.length ? startSegment + count : null
      response = JSON.stringify({ ...base, startSegment, nextSegment: next, segments: provenance.segments.slice(startSegment, startSegment + count) })
      if (Buffer.byteLength(response, 'utf8') <= MAX_READ_CHARS) return response
      count = Math.floor(count / 2)
    }
    return JSON.stringify({ error: 'shell output provenance metadata exceeds the response limit' })
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return JSON.stringify({ error: 'shell output artifact is missing or expired' })
    if (error instanceof SyntaxError) return JSON.stringify({ error: 'shell output artifact is malformed' })
    if (error instanceof Error && error.message === 'Shell output artifact integrity check failed') return JSON.stringify({ error: 'shell output artifact failed its integrity check' })
    throw error
  }
}

/** Read a bounded UTF-16 range from one shell artifact in the current session. */
export async function readShellOutput(sessionId: string, id: string, startChar = 0, maxChars = MAX_READ_CHARS, storageRoot?: string, recoveryRoot?: string, emergencyRoot?: string): Promise<string> {
  if (!ARTIFACT_ID.test(id)) return 'Error: invalid shell output ID'
  if (!Number.isSafeInteger(startChar) || startChar < 0) return 'Error: start_char must be a non-negative integer'
  if (!Number.isSafeInteger(maxChars) || maxChars < 512 || maxChars > MAX_READ_CHARS) return `Error: max_chars must be between 512 and ${MAX_READ_CHARS}`
  try {
    const raw = await readArtifactFrom(shellOutputDirectory(sessionId, storageRoot), shellOutputRecoveryDirectory(sessionId, storageRoot, recoveryRoot), shellOutputEmergencyDirectory(sessionId, emergencyRoot), id)
    const artifact = JSON.parse(raw) as Partial<ShellOutputMetadata> & { content: string; totalChars: number; storedChars: number }
    if (typeof artifact.content !== 'string' || !Number.isSafeInteger(artifact.totalChars) || !Number.isSafeInteger(artifact.storedChars)) {
      return 'Error: shell output artifact is malformed'
    }
    const masked = maskSecretsForOffsets(artifact.content)
    const redacted = artifact.redacted === true || masked !== artifact.content
    artifact.content = masked
    if (startChar > artifact.content.length) return `Error: start_char exceeds stored output length (${artifact.content.length})`
    if (safeGraphemeStart(artifact.content, startChar) !== startChar) return 'Error: start_char splits a Unicode grapheme cluster'
    const storageNote = artifact.storage === 'memory' ? '; memory-only fallback, unavailable after process exit'
      : artifact.storage === 'recovery-disk' ? '; recovery-disk fallback after primary storage failed'
        : artifact.storage === 'emergency-disk' ? '; emergency temporary-disk fallback after home-based stores failed' : ''
    const header = `[shell output ${id} · stored ${artifact.content.length} of ${artifact.totalChars} UTF-16 code units${redacted ? '; known secrets masked, offsets preserved' : ''}${storageNote}]\n`
    const cappedNote = artifact.truncated ? `\n[storage cap: only the first ${artifact.storedChars} of ${artifact.totalChars} characters were retained]` : ''
    const reserve = header.length + cappedNote.length + 100
    const end = safeGraphemeEnd(artifact.content, startChar + Math.max(0, maxChars - reserve))
    const body = artifact.content.slice(startChar, end)
    const continuation = end < artifact.content.length ? `\n[continue with start_char=${end}]` : '\n[end of stored output]'
    return `${header}${body}${continuation}${cappedNote}`
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return 'Error: shell output artifact is missing or expired'
    if (error instanceof SyntaxError) return 'Error: shell output artifact is malformed'
    if (error instanceof Error && error.message === 'Shell output artifact integrity check failed') return 'Error: shell output artifact failed its integrity check'
    throw error
  }
}

/** Read the already-redacted retained content for internal task reattachment. */
export async function readShellOutputContent(sessionId: string, id: string, storageRoot?: string, recoveryRoot?: string, emergencyRoot?: string): Promise<{ content: string; metadata: ShellOutputMetadata; provenance?: ShellStreamProvenance }> {
  if (!ARTIFACT_ID.test(id)) throw new Error('Invalid shell output ID')
  const raw = await readArtifactFrom(shellOutputDirectory(sessionId, storageRoot), shellOutputRecoveryDirectory(sessionId, storageRoot, recoveryRoot), shellOutputEmergencyDirectory(sessionId, emergencyRoot), id)
  const artifact = JSON.parse(raw) as Partial<ShellOutputMetadata> & { content?: unknown; provenance?: ShellStreamProvenance }
  if (typeof artifact.content !== 'string' || !Number.isSafeInteger(artifact.totalChars) || !Number.isSafeInteger(artifact.storedChars)
    || typeof artifact.truncated !== 'boolean' || !['disk', 'recovery-disk', 'emergency-disk', 'memory'].includes(artifact.storage ?? '')) {
    throw new Error('Shell output artifact is malformed')
  }
  const metadata: ShellOutputMetadata = {
    totalChars: artifact.totalChars!, storedChars: artifact.storedChars!, truncated: artifact.truncated,
    redacted: artifact.redacted === true, storage: artifact.storage as ShellOutputMetadata['storage'],
    ...(typeof artifact.retentionWarning === 'string' ? { retentionWarning: artifact.retentionWarning } : {}),
  }
  return { content: maskSecretsForOffsets(artifact.content), metadata, ...(artifact.provenance ? { provenance: artifact.provenance } : {}) }
}
