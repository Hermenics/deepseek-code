import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { chmod, lstat, mkdir, open, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { captureCurrentProcess, observeProcess, type ProcessIdentity, type ProcessObservation } from '../../orchestration/processIdentity.js'
import { captureShellStreams, waitForShellProcess, type ShellStreamProgress, type ShellStreamProvenance } from './streamCapture.js'
import { readShellOutputContent, shellOutputDirectory, withShellOutputArtifactLease, type ShellOutputMetadata } from './outputArtifact.js'
import { scrubbedEnv } from '../../utils/platform.js'
import { acquireFileLease } from '../../orchestration/fileLease.js'
import { MAX_SHELL_STREAM_JOURNAL_BYTES, ShellStreamJournal, readShellStreamJournalPage, type ShellStreamJournalPage } from './streamJournal.js'

const STATE_SCHEMA = 'shell_supervisor_v1'
const MAX_CONFIG_BYTES = 128 * 1024
const MAX_STATE_BYTES = 16 * 1024 * 1024
const MAX_ARGUMENT_BYTES = 64 * 1024
const SUPERVISOR_START_TIMEOUT_MS = 5_000
const SUPERVISOR_POLL_MS = 50
const SUPERVISOR_PROGRESS_WRITE_MS = 500
const MAX_SESSION_STREAM_JOURNAL_BYTES = 20 * 1024 * 1024
const MAX_SESSION_STREAM_JOURNALS = 10

export interface ShellSupervisorRequest {
  sessionId: string
  taskId: string
  storageRoot?: string
  recoveryRoot?: string
  fingerprint: string
  executable: string
  args: string[]
  cwd: string
  timeoutMs: number
}

export type ShellSupervisorState = {
  schema: typeof STATE_SCHEMA
  sessionId: string
  taskId: string
  fingerprint: string
  state: 'running' | 'done' | 'failed' | 'cancelled' | 'timed_out'
  identity: ProcessIdentity
  startedAt: string
  finishedAt?: string
  exitCode?: number | null
  signal?: string | null
  timedOut?: boolean
  cancelled?: boolean
  processGroupSettled: 'settled' | 'unknown'
  outputId?: string
  /** Quota pin persisted before the artifact exists; not an available output reference. */
  reservedOutputId?: string
  outputMetadata?: ShellOutputMetadata
  outputPreview?: string
  totalChars?: number
  /** Exact raw UTF-8 stdout/stderr bytes observed by the capture stream. */
  outputBytes?: number
  outputTruncated?: boolean
  drainTimedOut?: boolean
  provenance?: ShellStreamProvenance
  /** Used only when the bounded artifact store had to fall back to memory. Always redacted before writing. */
  memoryContent?: string
  streamAvailable?: boolean
  streamUnavailableReason?: 'retention-capacity' | 'storage-unavailable'
  streamLatestSequence?: number
  streamDroppedRecords?: number
  streamTruncated?: boolean
  streamRedactionConservative?: boolean
  streamGapUnknown?: boolean
}

export interface ShellSupervisorResult extends ShellSupervisorState {
  content: string
}

function supervisorKey(value: string): string { return createHash('sha256').update(value).digest('hex') }

function paths(request: Pick<ShellSupervisorRequest, 'sessionId' | 'taskId' | 'storageRoot'>) {
  const outputDirectory = shellOutputDirectory(request.sessionId, request.storageRoot)
  const directory = join(outputDirectory, 'supervisors')
  const key = supervisorKey(request.taskId)
  return { outputDirectory, directory, state: join(directory, `${key}.json`), lock: join(directory, `${key}.lock`), journal: join(directory, `${key}.stream.jsonl`) }
}

function validateRequest(request: ShellSupervisorRequest): void {
  const argsBytes = Array.isArray(request.args) ? request.args.reduce((sum, arg) => sum + Buffer.byteLength(arg, 'utf8'), 0) : Infinity
  if (!request.sessionId || request.sessionId.length > 256 || !request.taskId || request.taskId.length > 256
    || !/^[a-f0-9]{64}$/.test(request.fingerprint) || !request.executable || (request.executable.includes('/') && !request.executable.startsWith('/'))
    || !Array.isArray(request.args) || request.args.some(arg => typeof arg !== 'string') || argsBytes > MAX_ARGUMENT_BYTES
    || !request.cwd.startsWith('/') || !Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 86_400_000) {
    throw new Error('Invalid shell supervisor request')
  }
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink() || (typeof process.getuid === 'function' && info.uid !== process.getuid())) {
    throw new Error('Shell supervisor state directory is not privately owned')
  }
  await chmod(directory, 0o700)
}

async function reserveStreamJournal(request: ShellSupervisorRequest, runningState: ShellSupervisorState): Promise<ShellStreamJournal | undefined> {
  const { directory, state: statePath, journal: journalPath } = paths(request)
  let lease: Awaited<ReturnType<typeof acquireFileLease>> | undefined
  try {
    lease = await acquireFileLease(`shell-stream-journal-retention:${resolve(directory)}`)
    const entries = await readdir(directory, { withFileTypes: true })
    const journals: Array<{ name: string; path: string; bytes: number; modifiedAt: number; active: boolean }> = []
    for (const entry of entries) {
      if (!/^[a-f0-9]{64}\.stream\.jsonl$/i.test(entry.name)) continue
      const path = join(directory, entry.name)
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink() || (typeof process.getuid === 'function' && info.uid !== process.getuid())) return undefined
      const statePathForJournal = join(directory, entry.name.replace(/\.stream\.jsonl$/, '.json'))
      let active = false
      try {
        const state = JSON.parse(readFileSync(statePathForJournal, 'utf8')) as Partial<ShellSupervisorState>
        if (state.state === 'running') {
          if (!isProcessIdentity(state.identity)) active = true
          else active = isActiveOwnedSupervisor(observeProcess(observation(state.identity)), state.identity)
        }
      } catch { active = true }
      journals.push({ name: entry.name, path, bytes: info.size, modifiedAt: info.mtimeMs, active })
    }
    const targetName = `${supervisorKey(request.taskId)}.stream.jsonl`
    const existingTarget = journals.find(item => item.name === targetName)
    if (existingTarget?.active) return undefined
    if (existingTarget) {
      await unlink(existingTarget.path).catch(() => {})
      journals.splice(journals.indexOf(existingTarget), 1)
    }
    const activeCount = journals.filter(item => item.active).length
    const terminalJournals = journals.filter(item => !item.active).sort((left, right) => left.modifiedAt - right.modifiedAt)
    let terminalBytes = terminalJournals.reduce((sum, item) => sum + item.bytes, 0)
    let terminalCount = terminalJournals.length
    while (activeCount + terminalCount + 1 > MAX_SESSION_STREAM_JOURNALS
      || activeCount * MAX_SHELL_STREAM_JOURNAL_BYTES + terminalBytes + MAX_SHELL_STREAM_JOURNAL_BYTES > MAX_SESSION_STREAM_JOURNAL_BYTES) {
      const oldest = terminalJournals.shift()
      if (!oldest) return undefined
      await unlink(oldest.path).catch(() => {})
      terminalBytes -= oldest.bytes
      terminalCount--
    }
    const file = await open(journalPath, 'wx', 0o600)
    await file.close()
    const journal = new ShellStreamJournal(journalPath)
    await journal.open()
    const stats = journal.stats()
    await writeState(statePath, { ...runningState, streamAvailable: stats.available,
      ...(!stats.available ? { streamUnavailableReason: 'storage-unavailable' as const } : {}),
      streamLatestSequence: 0, streamDroppedRecords: 0, streamTruncated: false, streamRedactionConservative: false,
      streamGapUnknown: !stats.available })
    return stats.available ? journal : undefined
  } catch {
    await writeState(statePath, { ...runningState, streamAvailable: false, streamUnavailableReason: 'storage-unavailable',
      streamLatestSequence: 0, streamDroppedRecords: 0, streamTruncated: true, streamRedactionConservative: false, streamGapUnknown: true }).catch(() => {})
    return undefined
  } finally { await lease?.release().catch(() => {}) }
}

async function writeState(path: string, value: ShellSupervisorState): Promise<void> {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  await rename(temporary, path)
}

function readStateSync(request: ShellSupervisorRequest): ShellSupervisorState | undefined {
  const { state: path } = paths(request)
  try {
    const info = lstatSync(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_STATE_BYTES || (typeof process.getuid === 'function' && info.uid !== process.getuid())) return undefined
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<ShellSupervisorState>
    if (value.schema !== STATE_SCHEMA || value.sessionId !== request.sessionId || value.taskId !== request.taskId
      || value.fingerprint !== request.fingerprint || !['running', 'done', 'failed', 'cancelled', 'timed_out'].includes(value.state ?? '')
      || !isProcessIdentity(value.identity) || !['settled', 'unknown'].includes(value.processGroupSettled ?? '')
      || value.outputPreview !== undefined && (typeof value.outputPreview !== 'string' || value.outputPreview.length > 100_000)
      || value.totalChars !== undefined && (!Number.isSafeInteger(value.totalChars) || value.totalChars < 0)
      || value.outputBytes !== undefined && (!Number.isSafeInteger(value.outputBytes) || value.outputBytes < 0)
      || value.outputTruncated !== undefined && typeof value.outputTruncated !== 'boolean'
      || value.streamAvailable !== undefined && typeof value.streamAvailable !== 'boolean'
      || value.streamLatestSequence !== undefined && (!Number.isSafeInteger(value.streamLatestSequence) || value.streamLatestSequence < 0)
      || value.streamDroppedRecords !== undefined && (!Number.isSafeInteger(value.streamDroppedRecords) || value.streamDroppedRecords < 0)
      || value.streamTruncated !== undefined && typeof value.streamTruncated !== 'boolean'
      || value.streamRedactionConservative !== undefined && typeof value.streamRedactionConservative !== 'boolean'
      || value.streamGapUnknown !== undefined && typeof value.streamGapUnknown !== 'boolean') return undefined
    if (value.memoryContent !== undefined && (typeof value.memoryContent !== 'string' || value.memoryContent.length > 2_000_000)) return undefined
    return value as ShellSupervisorState
  } catch { return undefined }
}

function isProcessIdentity(value: unknown): value is ProcessIdentity {
  const identity = value as Partial<ProcessIdentity> | null
  return !!identity && identity.platform === 'linux' && Number.isSafeInteger(identity.pid) && identity.pid! > 1
    && typeof identity.bootId === 'string' && typeof identity.pidNamespace === 'string'
    && typeof identity.startTimeTicks === 'string' && Number.isSafeInteger(identity.sessionId) && Number.isSafeInteger(identity.processGroupId)
    && identity.sessionId! > 0 && identity.processGroupId === identity.pid
}

function sameIdentity(left: ProcessIdentity, right: ProcessIdentity): boolean {
  return left.pid === right.pid && left.bootId === right.bootId && left.pidNamespace === right.pidNamespace
    && left.startTimeTicks === right.startTimeTicks && left.sessionId === right.sessionId
    && left.processGroupId === right.processGroupId
}

function observation(identity: ProcessIdentity): ProcessObservation {
  return { identity, status: 'alive', observedAt: new Date().toISOString(), provenance: 'kernel', scope: 'process-group', progress: 'not-measured' }
}

function terminal(state: ShellSupervisorState['state']): state is Exclude<ShellSupervisorState['state'], 'running'> {
  return state !== 'running'
}

async function delay(ms: number): Promise<void> { await new Promise(resolve => setTimeout(resolve, ms)) }

function helperEntrypoint(): string {
  const current = dirname(fileURLToPath(import.meta.url))
  const source = join(current, 'supervisorEntrypoint.ts')
  if (existsSync(source)) return source
  const bundled = join(current, 'shell-supervisor.mjs')
  if (existsSync(bundled)) return bundled
  throw new Error('Shell supervisor entrypoint is missing from this installation')
}

/** Launch a detached supervisor once. An existing lock or state always fails closed instead of replaying the command. */
export async function launchShellSupervisor(request: ShellSupervisorRequest, trackProcess?: (child: ChildProcess) => void): Promise<ChildProcess> {
  validateRequest(request)
  if (process.platform !== 'linux') throw new Error('Detached shell reattachment is supported only on Linux')
  const { outputDirectory, directory, lock } = paths(request)
  await ensurePrivateDirectory(dirname(outputDirectory))
  await ensurePrivateDirectory(outputDirectory)
  await ensurePrivateDirectory(directory)
  const prior = readStateSync(request)
  if (prior) throw new Error(`Shell supervisor already exists in state '${prior.state}'`)
  let lockFile
  try { lockFile = await open(lock, 'wx', 0o600) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Shell supervisor already exists or may have been interrupted; refusing to replay')
    throw error
  }
  await lockFile.writeFile(JSON.stringify({ schema: STATE_SCHEMA, sessionId: request.sessionId, taskId: request.taskId, fingerprint: request.fingerprint }))
  await lockFile.close()

  let child: ChildProcess | undefined
  try {
    child = spawn(process.execPath, [helperEntrypoint()], {
      cwd: request.cwd,
      env: scrubbedEnv(),
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
    })
    await new Promise<void>((resolve, reject) => {
      child!.once('spawn', resolve)
      child!.once('error', reject)
    })
    trackProcess?.(child)
    const payload = JSON.stringify(request)
    if (Buffer.byteLength(payload, 'utf8') > MAX_CONFIG_BYTES) throw new Error('Shell supervisor configuration exceeds its limit')
    child.stdin!.end(payload)
    child.unref()
  } catch (error) {
    if (child?.pid) {
      try { child.kill('SIGKILL') } catch { /* The failed helper may already have exited. */ }
    }
    await unlink(lock).catch(() => {})
    throw error
  }

  const deadline = Date.now() + SUPERVISOR_START_TIMEOUT_MS
  while (Date.now() < deadline) {
    const current = readStateSync(request)
    if (current) return child
    if (child.exitCode !== null || child.signalCode !== null) break
    await delay(10)
  }
  if (!readStateSync(request)) throw new Error('Shell supervisor did not publish its owned process identity')
  return child
}

/** Reattach only to the matching task identity; never creates a replacement process. */
export async function waitForShellSupervisor(request: ShellSupervisorRequest, signal?: AbortSignal, onProgress?: (state: ShellSupervisorState) => void): Promise<ShellSupervisorResult> {
  validateRequest(request)
  if (process.platform !== 'linux') throw new Error('Detached shell reattachment is supported only on Linux')
  let cancelSent = false
  const requestCancel = () => {
    if (cancelSent) return
    cancelSent = true
    const state = readStateSync(request)
    if (!state || terminal(state.state)) return
    const observed = observeProcess(observation(state.identity))
    if (!isActiveOwnedSupervisor(observed, state.identity)) return
    try {
      // shortcut: /proc revalidation and PID signaling are not atomic; use a per-user supervisor service to remove this race.
      process.kill(state.identity.pid, 'SIGTERM')
    } catch { /* Re-read below distinguishes an exited helper from an active one. */ }
  }
  signal?.addEventListener('abort', requestCancel, { once: true })
  if (signal?.aborted) requestCancel()
  let lastProgressChars = -1
  let lastProgressBytes = -1
  try {
    while (true) {
      const state = readStateSync(request)
      if (!state) throw new Error('Shell supervisor state is unavailable or does not match this task; refusing to rerun it')
      const hasNewProgress = state.totalChars !== undefined && state.totalChars !== lastProgressChars
        || state.outputBytes !== undefined && state.outputBytes !== lastProgressBytes
      if (state.state === 'running' && hasNewProgress) {
        lastProgressChars = state.totalChars ?? lastProgressChars
        lastProgressBytes = state.outputBytes ?? lastProgressBytes
        onProgress?.(state)
      }
      if (terminal(state.state)) {
        let resultState = state
        let retained: Awaited<ReturnType<typeof readShellOutputContent>> | undefined
        if (state.outputId) retained = await readShellOutputContent(request.sessionId, state.outputId, request.storageRoot, request.recoveryRoot).catch(() => undefined)
        if (!retained && state.outputMetadata?.storage === 'memory') {
          await withShellOutputArtifactLease(request.sessionId, request.storageRoot, async saveOutput => {
            const latestState = readStateSync(request)
            if (!latestState || !terminal(latestState.state)) {
              throw new Error('Shell supervisor terminal state changed while restoring its output artifact')
            }
            if (latestState.outputId) {
              retained = await readShellOutputContent(request.sessionId, latestState.outputId, request.storageRoot, request.recoveryRoot).catch(() => undefined)
            }
            if (retained) {
              resultState = latestState
              return
            }

            const memoryContent = latestState.memoryContent
            if (memoryContent === undefined) {
              throw Object.assign(new Error('Shell supervisor finished but its output artifact is unavailable'), {
                supervisorState: latestState, processGroupSettled: latestState.processGroupSettled,
              })
            }
            const artifactId = randomUUID()
            const statePath = paths(request).state
            await writeState(statePath, { ...latestState, reservedOutputId: artifactId })
            const artifact = await saveOutput(memoryContent, latestState.totalChars ?? memoryContent.length,
              latestState.provenance, request.recoveryRoot, undefined, artifactId)
            retained = await readShellOutputContent(request.sessionId, artifact.id, request.storageRoot, request.recoveryRoot)
            resultState = {
              ...latestState,
              outputId: artifact.id,
              reservedOutputId: undefined,
              outputMetadata: artifact.metadata,
              memoryContent: artifact.metadata.storage === 'memory' ? retained.content : undefined,
            }
            await writeState(statePath, resultState)
          })
        }
        const content = retained?.content ?? resultState.memoryContent
        if (content === undefined) throw Object.assign(new Error('Shell supervisor finished but its output artifact is unavailable'), { supervisorState: resultState, processGroupSettled: resultState.processGroupSettled })
        await stopFinishedSupervisor(resultState.identity)
        return { ...resultState, content,
          outputMetadata: retained?.metadata ?? resultState.outputMetadata, provenance: retained?.provenance ?? resultState.provenance }
      }
      const observed = observeProcess(observation(state.identity))
      if (!isActiveOwnedSupervisor(observed, state.identity)) {
        throw Object.assign(new Error('Shell supervisor exited before persisting its result; effects remain unreconciled'), { supervisorState: state, processGroupSettled: 'unknown' })
      }
      await delay(SUPERVISOR_POLL_MS)
    }
  } finally { signal?.removeEventListener('abort', requestCancel) }
}

async function stopFinishedSupervisor(identity: ProcessIdentity): Promise<void> {
  const active = () => {
    const observed = observeProcess(observation(identity))
    return isActiveOwnedSupervisor(observed, identity)
  }
  const exitDeadline = Date.now() + 250
  while (Date.now() < exitDeadline && active()) await delay(10)
  if (!active()) return
  try {
    // The supervisor has already persisted the terminal state and output, so no command effects remain to protect.
    const observed = observeProcess(observation(identity))
    if (isActiveOwnedSupervisor(observed, identity)) process.kill(identity.pid, 'SIGTERM')
  } catch { /* Recheck below; an exited supervisor is already settled. */ }
  const deadline = Date.now() + 500
  while (Date.now() < deadline && active()) await delay(20)
  if (!active()) return
  try {
    const observed = observeProcess(observation(identity))
    if (isActiveOwnedSupervisor(observed, identity)) process.kill(identity.pid, 'SIGKILL')
  } catch { /* Recheck below; a reused or exited PID is never accepted as this supervisor. */ }
  const killDeadline = Date.now() + 500
  while (Date.now() < killDeadline && active()) await delay(20)
  if (active()) throw new Error('Completed shell supervisor could not be reaped safely')
}

function isActiveOwnedSupervisor(observed: ProcessObservation, identity: ProcessIdentity): boolean {
  return !!observed.identity && sameIdentity(observed.identity, identity) && observed.scope === 'process-group'
    && observed.status === 'alive' && observed.processGroup?.status === 'alive'
}

/** Synchronous resolver check used by task restoration; invalid or stale state never enables command replay. */
export function shellSupervisorCanReattach(request: ShellSupervisorRequest, processObservation: ProcessObservation | undefined): boolean {
  if (!processObservation?.identity || process.platform !== 'linux') return false
  const state = readStateSync(request)
  return !!state && (state.state === 'running' || terminal(state.state)) && sameIdentity(state.identity, processObservation.identity)
}

function readStateForTask(sessionId: string, taskId: string, storageRoot?: string): ShellSupervisorState | undefined {
  try {
    const statePath = paths({ sessionId, taskId, storageRoot }).state
    const info = lstatSync(statePath)
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_STATE_BYTES
      || (typeof process.getuid === 'function' && info.uid !== process.getuid())) return undefined
    const first = JSON.parse(readFileSync(statePath, 'utf8')) as Partial<ShellSupervisorState>
    if (first.sessionId !== sessionId || first.taskId !== taskId || typeof first.fingerprint !== 'string') return undefined
    return readStateSync({ sessionId, taskId, storageRoot, fingerprint: first.fingerprint,
      executable: '/bin/true', args: [], cwd: '/', timeoutMs: 1 })
  } catch { return undefined }
}

/** Read cursor-paged, already-redacted output without reattaching or executing the command. */
export async function readShellSupervisorStreamPage(
  sessionId: string,
  taskId: string,
  afterSequence = 0,
  maxChars = 20_000,
  storageRoot?: string,
): Promise<ShellStreamJournalPage> {
  const empty = (error: ShellStreamJournalPage['error']): ShellStreamJournalPage => ({ schema: 'shell_stream_journal_v1', records: [],
    cursor: Number.isSafeInteger(afterSequence) && afterSequence >= 0 ? afterSequence : 0, latestSequence: 0, gap: false,
    finished: false, truncated: false, redactionConservative: false, incompleteTail: false, incomplete: false, gapUnknown: false, error })
  if (process.platform !== 'linux' || !sessionId || sessionId.length > 256 || !taskId || taskId.length > 256) return empty('unavailable')
  const state = readStateForTask(sessionId, taskId, storageRoot)
  if (!state) return empty('expired')
  if (state.streamAvailable !== true) return { ...empty('unavailable'), finished: terminal(state.state), truncated: state.streamTruncated === true,
    latestSequence: state.streamLatestSequence ?? 0, redactionConservative: state.streamRedactionConservative === true,
    gapUnknown: state.streamGapUnknown === true }
  const active = state.state === 'running' && isActiveOwnedSupervisor(observeProcess(observation(state.identity)), state.identity)
  const incomplete = state.state === 'running' && !active
  return readShellStreamJournalPage(paths({ sessionId, taskId, storageRoot }).journal, afterSequence,
    state.streamLatestSequence ?? 0, terminal(state.state), state.streamTruncated === true,
    state.streamRedactionConservative === true, maxChars, incomplete, state.streamGapUnknown === true)
}

/** Supervisor-side runner. Its raw output stays in process memory until the redacted artifact is written. */
export async function runShellSupervisor(request: ShellSupervisorRequest): Promise<void> {
  validateRequest(request)
  const identityObservation = captureCurrentProcess()
  if (!identityObservation.identity || identityObservation.scope !== 'process-group') throw new Error('Shell supervisor could not capture its Linux process-group identity')
  const identity = identityObservation.identity
  const { outputDirectory, directory, state: statePath } = paths(request)
  await ensurePrivateDirectory(dirname(outputDirectory))
  await ensurePrivateDirectory(outputDirectory)
  await ensurePrivateDirectory(directory)
  const startedAt = new Date().toISOString()
  const runningState: ShellSupervisorState = { schema: STATE_SCHEMA, sessionId: request.sessionId, taskId: request.taskId,
    fingerprint: request.fingerprint, state: 'running', identity, startedAt, processGroupSettled: 'unknown' }
  let journal = await reserveStreamJournal(request, runningState)
  const persistedInitialState = readStateSync(request)
  if (!persistedInitialState || persistedInitialState.streamAvailable === undefined) {
    await writeState(statePath, { ...runningState, streamAvailable: false, streamUnavailableReason: 'retention-capacity',
      streamLatestSequence: 0, streamDroppedRecords: 0, streamTruncated: true, streamRedactionConservative: false, streamGapUnknown: true })
  }
  if (!journal) {
    journal = new ShellStreamJournal(paths(request).journal)
    journal.disable()
  }
  const initialState = readStateSync(request) ?? { ...runningState, streamAvailable: false, streamTruncated: true }
  const streamState = () => {
    const stats = journal?.stats()
    return {
      streamAvailable: stats?.available ?? initialState.streamAvailable ?? false,
      ...(!stats?.available && initialState.streamUnavailableReason ? { streamUnavailableReason: initialState.streamUnavailableReason } : {}),
      streamLatestSequence: stats?.latestSequence ?? initialState.streamLatestSequence ?? 0,
      streamDroppedRecords: stats?.droppedRecords ?? initialState.streamDroppedRecords ?? 0,
      streamTruncated: stats?.truncated ?? initialState.streamTruncated ?? true,
      streamRedactionConservative: stats?.redactionConservative ?? initialState.streamRedactionConservative ?? false,
      streamGapUnknown: stats?.gapUnknown ?? initialState.streamGapUnknown ?? false,
    }
  }

  const controller = new AbortController()
  const abort = () => { if (!controller.signal.aborted) controller.abort(new Error('Shell supervisor was asked to stop')) }
  process.on('SIGTERM', abort)
  const subprocess = spawn(request.executable, request.args, {
    cwd: request.cwd,
    env: scrubbedEnv(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const processExited = new Promise<void>(resolve => {
    subprocess.once('exit', () => resolve())
    subprocess.once('error', () => resolve())
  })
  let latestProgress: ShellStreamProgress | undefined
  let lastProgressChars = 0
  let lastProgressBytes = 0
  let progressWrites = Promise.resolve()
  const persistProgress = () => {
    const progress = latestProgress
    if (!progress || progress.totalChars === lastProgressChars && progress.totalBytes === lastProgressBytes) return
    lastProgressChars = progress.totalChars
    lastProgressBytes = progress.totalBytes
    progressWrites = progressWrites.then(async () => {
      await journal?.flush(200)
      const snapshot: ShellSupervisorState = { ...initialState, totalChars: progress.totalChars, outputBytes: progress.totalBytes,
        outputPreview: journal!.preview(), outputTruncated: progress.truncated, ...streamState() }
      await writeState(statePath, snapshot)
    }).catch(() => {})
  }
  const progressTimer = setInterval(persistProgress, SUPERVISOR_PROGRESS_WRITE_MS)
  progressTimer.unref?.()
  const capturePromise = captureShellStreams(subprocess.stdout, subprocess.stderr, processExited,
    progress => { latestProgress = progress }, chunk => journal?.push(chunk))
  const [capture, execution] = await Promise.allSettled([
    capturePromise,
    waitForShellProcess(subprocess, request.timeoutMs, controller.signal),
  ])
  clearInterval(progressTimer)
  persistProgress()
  await progressWrites
  await journal?.finish(1_000)
  const finalStreamState = streamState()
  const output = capture.status === 'fulfilled' ? capture.value : {
    content: '', preview: '', totalChars: 0, totalBytes: 0, truncated: false, drainTimedOut: true,
    provenance: { schema: 'shell_channel_provenance_v1', ordering: 'observed-arrival', stdoutChars: 0, stderrChars: 0,
      retainedChars: 0, segments: [], segmentsOmitted: 0, contentOmitted: 0, drainTimedOut: true } as ShellStreamProvenance,
  }
  let state: ShellSupervisorState['state'] = 'done'
  let exitCode: number | null = 0
  let signal: string | null = null
  let timedOut = false
  let cancelled = false
  if (execution.status === 'rejected') {
    const error = execution.reason as { exitCode?: number; signal?: string | null; timedOut?: boolean; cancelled?: boolean }
    exitCode = typeof error.exitCode === 'number' ? error.exitCode : subprocess.exitCode
    signal = error.signal ?? subprocess.signalCode
    timedOut = error.timedOut === true
    cancelled = error.cancelled === true || controller.signal.aborted
    state = timedOut ? 'timed_out' : cancelled ? 'cancelled' : 'failed'
  }
  if (capture.status === 'rejected' && state === 'done') state = 'failed'
  const processGroupSettled = (subprocess.exitCode !== null || subprocess.signalCode !== null) && !output.drainTimedOut ? 'settled' : 'unknown'
  const artifactId = randomUUID()
  await withShellOutputArtifactLease(request.sessionId, request.storageRoot, async saveOutput => {
    await writeState(statePath, {
      ...initialState, processGroupSettled, reservedOutputId: artifactId, outputPreview: journal!.preview(),
      totalChars: output.totalChars, outputBytes: output.totalBytes, outputTruncated: output.truncated, ...finalStreamState,
    })
    const saved = await saveOutput(output.content, output.totalChars, output.provenance, request.recoveryRoot, undefined, artifactId)
    const memoryContent = saved.metadata.storage === 'memory'
      ? (await readShellOutputContent(request.sessionId, saved.id, request.storageRoot, request.recoveryRoot)).content
      : undefined
    const finalState: ShellSupervisorState = {
      schema: STATE_SCHEMA, sessionId: request.sessionId, taskId: request.taskId, fingerprint: request.fingerprint,
      state, identity, startedAt, finishedAt: new Date().toISOString(), exitCode, signal, timedOut, cancelled,
      processGroupSettled, outputId: saved.id, outputMetadata: saved.metadata,
      outputPreview: journal!.preview(), totalChars: output.totalChars,
      outputBytes: output.totalBytes, outputTruncated: output.truncated, drainTimedOut: output.drainTimedOut, provenance: output.provenance,
      ...finalStreamState,
      ...(memoryContent !== undefined ? { memoryContent } : {}),
    }
    await writeState(statePath, finalState)
  })
  process.off('SIGTERM', abort)
}

/** Parse the one-time private stdin configuration for the standalone Bun supervisor entrypoint. */
export async function readShellSupervisorRequest(input: AsyncIterable<Uint8Array>): Promise<ShellSupervisorRequest> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of input) {
    const buffer = Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > MAX_CONFIG_BYTES) throw new Error('Shell supervisor configuration exceeds its limit')
    chunks.push(buffer)
  }
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ShellSupervisorRequest
  validateRequest(request)
  return request
}
