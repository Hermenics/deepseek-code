import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { mkdir, open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { acquireFileLease } from '../orchestration/fileLease.js'
import type { WorkflowRpcUsage, WorkflowRun } from './types.js'

const MAX_REPLAY_RUNS = 100
/** A missing or expired lease is history, never a reason to mutate the recorded run. */
export const WORKFLOW_LEASE_TTL_MS = 15_000
export const WORKFLOW_LEASE_HEARTBEAT_MS = 5_000
export const WORKFLOW_ACTIVE_STATUSES: ReadonlySet<WorkflowRun['status']> = new Set(['queued', 'running', 'paused'])
const WORKFLOW_LEASE_LOCK_PREFIX = 'workflow-run-lease:'
const approvalFileLocks = new Map<string, Promise<void>>()

export interface WorkflowRunLease {
  schemaVersion: 1
  runId: string
  sessionId: string
  pid: number
  token: string
  startedAt: string
  heartbeatAt: string
}

export function isWorkflowRunActive(run: Pick<WorkflowRun, 'status'>): boolean {
  return WORKFLOW_ACTIVE_STATUSES.has(run.status)
}

/** @internal Stable cross-process lock identity shared by all mutations to one run's lease. */
export function workflowLeaseLockResource(path: string): string {
  return `${WORKFLOW_LEASE_LOCK_PREFIX}${resolve(path)}`
}

export interface WorkflowJournalEntry {
  index: number
  fingerprint: string
  method: 'agent' | 'workflow'
  args: unknown[]
  status: 'running' | 'completed' | 'failed'
  result?: unknown
  usage?: WorkflowRpcUsage
  budgetExhausted?: boolean
  error?: string
  timestamp: string
}

export interface WorkflowJournal {
  schemaVersion: 1
  scriptHash: string
  argsHash: string
  optionsHash: string
  entries: WorkflowJournalEntry[]
}

interface WorkflowStoreOptions {
  projectRoot: string
  sessionId: string
  baseDirectory?: string
}

function stable(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(',')}}`
}

export function hashWorkflowValue(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex')
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

async function privateText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, value, { mode: 0o600 })
  await rename(temporary, path)
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T } catch { return undefined }
}

/** Serialize lease read/modify/delete sequences across managers and OS processes. */
async function withLeaseLock<T>(path: string, action: () => Promise<T>): Promise<T> {
  const lock = await acquireFileLease(workflowLeaseLockResource(path), { kind: 'workflow-run-lease', path })
  try { return await action() }
  finally { await lock.release() }
}

async function withApprovalFileLock<T>(file: string, action: () => Promise<T>): Promise<T> {
  const previous = approvalFileLocks.get(file) ?? Promise.resolve()
  let release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  approvalFileLocks.set(file, gate)
  await previous
  try { return await action() }
  finally {
    release()
    if (approvalFileLocks.get(file) === gate) approvalFileLocks.delete(file)
  }
}

export class WorkflowStore {
  readonly root: string
  /** Project-wide state directory; run scripts from earlier sessions of the same project live below it. */
  readonly projectDirectory: string

  constructor(readonly options: WorkflowStoreOptions) {
    const projectKey = hashWorkflowValue(resolve(options.projectRoot)).slice(0, 32)
    const sessionKey = hashWorkflowValue(options.sessionId).slice(0, 32)
    this.projectDirectory = options.baseDirectory ?? join(homedir(), '.deepseek', 'projects', projectKey)
    this.root = options.baseDirectory ?? join(this.projectDirectory, sessionKey, 'workflows')
  }

  runDirectory(runId: string): string {
    return join(this.root, runId)
  }

  scriptPath(runId: string): string {
    return join(this.runDirectory(runId), 'workflow.js')
  }

  journalPath(runId: string): string {
    return join(this.runDirectory(runId), 'journal.json')
  }

  leasePath(runId: string): string {
    return join(this.runDirectory(runId), 'lease.json')
  }

  async createRun(run: WorkflowRun, script: string, args: unknown): Promise<void> {
    const directory = this.runDirectory(run.runId)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await Promise.all([
      privateText(this.scriptPath(run.runId), script),
      atomicJson(join(directory, 'args.json'), args ?? {}),
      this.writeRun(run),
      this.writeJournal(run.runId, { schemaVersion: 1, scriptHash: run.scriptHash, argsHash: run.argsHash, optionsHash: run.optionsHash, entries: [] }),
    ])
  }

  async writeRun(run: WorkflowRun): Promise<void> {
    await atomicJson(join(this.runDirectory(run.runId), 'run.json'), run)
  }

  /**
   * Claims a newly-created run for this process. Leases are deliberately separate from run.json:
   * a crashed process can leave a valid historical record without making the next TUI lie that it
   * is still running. A lease is never stolen automatically, because a slow live process is not
   * proof of death.
   */
  async acquireRunLease(runId: string, sessionId: string, now = new Date()): Promise<WorkflowRunLease> {
    const path = this.leasePath(runId)
    return withLeaseLock(path, async () => {
      const timestamp = now.toISOString()
      const lease: WorkflowRunLease = {
        schemaVersion: 1, runId, sessionId, pid: process.pid, token: randomUUID(),
        startedAt: timestamp, heartbeatAt: timestamp,
      }
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      let file: Awaited<ReturnType<typeof open>>
      try { file = await open(path, 'wx', 0o600) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Workflow run '${runId}' already has an owner lease`)
        throw error
      }
      try { await file.writeFile(`${JSON.stringify(lease)}\n`) }
      catch (error) { await unlink(path).catch(() => undefined); throw error }
      finally { await file.close() }
      return lease
    })
  }

  /** Renews a lease only while its opaque owner token still matches. */
  async heartbeatRunLease(lease: WorkflowRunLease, now = new Date()): Promise<boolean> {
    const path = this.leasePath(lease.runId)
    return withLeaseLock(path, async () => {
      const current = await readJson<WorkflowRunLease>(path)
      if (!sameLeaseOwner(current, lease)) return false
      await atomicJson(path, { ...current, heartbeatAt: now.toISOString() })
      return true
    })
  }

  /** Releases only this process's lease; a replacement owner can never be removed accidentally. */
  async releaseRunLease(lease: WorkflowRunLease): Promise<void> {
    const path = this.leasePath(lease.runId)
    await withLeaseLock(path, async () => {
      const current = await readJson<WorkflowRunLease>(path)
      if (sameLeaseOwner(current, lease)) await unlink(path).catch(() => undefined)
    })
  }

  /**
   * Returns true only for a recent lease. It intentionally does not probe or kill the recorded
   * PID: PID reuse, a blocked event loop, and multiple TTYs make that unsafe. Unknown/stale runs
   * remain available through list(), get(), restart(), and replay as historical records.
   */
  async hasLiveLease(run: WorkflowRun, now = Date.now()): Promise<boolean> {
    if (!isWorkflowRunActive(run)) return false
    const directory = await this.findRunDirectory(run.runId)
    if (!directory) return false
    const lease = await readJson<WorkflowRunLease>(join(directory, 'lease.json'))
    if (!isWorkflowLease(lease) || lease.runId !== run.runId || lease.sessionId !== run.sessionId) return false
    const heartbeat = Date.parse(lease.heartbeatAt)
    if (!Number.isFinite(heartbeat)) return false
    // Permit modest wall-clock skew, but do not let a wildly future timestamp pin activity forever.
    return heartbeat <= now + WORKFLOW_LEASE_TTL_MS && now - heartbeat <= WORKFLOW_LEASE_TTL_MS
  }

  /** Sibling session directories of this project, so runs survive a restart of the TUI. */
  private sessionRoots(): Promise<string[]> {
    // Do not cache this directory scan: another TUI/session can start after this store was
    // constructed, and its fresh lease must become visible to activity consumers.
    return this.options.baseDirectory
      ? Promise.resolve([this.root])
      : readdir(this.projectDirectory, { withFileTypes: true }).catch(() => []).then(sessions => {
        const others = sessions.filter(entry => entry.isDirectory()).map(entry => join(this.projectDirectory, entry.name, 'workflows')).filter(path => path !== this.root)
        return [this.root, ...others]
      })
  }

  /** Locates a run by id in this session first, then in earlier sessions of the same project. */
  async findRunDirectory(runId: string): Promise<string | undefined> {
    if (!runId || basename(runId) !== runId || runId.startsWith('.')) return undefined
    for (const root of await this.sessionRoots()) {
      const candidate = join(root, runId)
      if (await readJson(join(candidate, 'run.json'))) return candidate
    }
    return undefined
  }

  async findRunIdsByPrefix(prefix: string): Promise<string[]> {
    const ids = new Set<string>()
    for (const root of await this.sessionRoots()) {
      const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) if (entry.isDirectory() && entry.name.startsWith(prefix)) ids.add(entry.name)
    }
    return [...ids]
  }

  async readRun(runId: string): Promise<WorkflowRun | undefined> {
    const directory = await this.findRunDirectory(runId)
    return directory ? readJson<WorkflowRun>(join(directory, 'run.json')) : undefined
  }

  async readScript(runId: string): Promise<string | undefined> {
    const directory = await this.findRunDirectory(runId)
    if (!directory) return undefined
    try { return await readFile(join(directory, 'workflow.js'), 'utf8') } catch { return undefined }
  }

  async readArgs(runId: string): Promise<unknown> {
    const directory = await this.findRunDirectory(runId)
    return (directory ? await readJson(join(directory, 'args.json')) : undefined) ?? {}
  }

  async writeJournal(runId: string, journal: WorkflowJournal): Promise<void> {
    await atomicJson(this.journalPath(runId), journal)
  }

  async readJournal(runId: string): Promise<WorkflowJournal | undefined> {
    const directory = await this.findRunDirectory(runId)
    const journal = directory ? await readJson<WorkflowJournal>(join(directory, 'journal.json')) : undefined
    if (!journal || !Array.isArray(journal.entries) || !journal.entries.every(entry => entry && typeof entry === 'object')) return undefined
    return journal
  }

  private async scanRuns(): Promise<WorkflowRun[]> {
    const roots = await this.sessionRoots()
    const entries = await Promise.all(roots.map(async root => ({ root, entries: await readdir(root, { withFileTypes: true }).catch(() => []) })))
    const runs = (await Promise.all(entries.flatMap(({ root, entries }) => entries.filter(entry => entry.isDirectory()).map(entry => readJson<WorkflowRun>(join(root, entry.name, 'run.json'))))))
      .filter((run): run is WorkflowRun => Boolean(run))
    return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async listRuns(): Promise<WorkflowRun[]> {
    return (await this.scanRuns()).slice(0, MAX_REPLAY_RUNS)
  }

  /** Lists every persisted active-status run, without the replay/history result cap. */
  async listActiveRuns(): Promise<WorkflowRun[]> {
    return (await this.scanRuns()).filter(isWorkflowRunActive)
  }

  async findReplay(scriptHash: string, argsHash: string, optionsHash: string, excludeRunId?: string): Promise<WorkflowJournal | undefined> {
    let best: WorkflowJournal | undefined
    let bestPrefix = -1
    for (const run of await this.listRuns()) {
      if (run.runId === excludeRunId || run.scriptHash !== scriptHash || run.argsHash !== argsHash || run.optionsHash !== optionsHash || isWorkflowRunActive(run)) continue
      const journal = await this.readJournal(run.runId)
      if (!journal || journal.scriptHash !== scriptHash || journal.argsHash !== argsHash || journal.optionsHash !== optionsHash) continue
      const prefix = journal.entries.findIndex(entry => entry.status !== 'completed')
      const length = prefix < 0 ? journal.entries.length : prefix
      if (prefix < 0) return journal
      if (length > bestPrefix) { best = journal; bestPrefix = length }
    }
    return best
  }
}

function isWorkflowLease(value: unknown): value is WorkflowRunLease {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WorkflowRunLease>
  return candidate.schemaVersion === 1 && typeof candidate.runId === 'string' && candidate.runId.length > 0 &&
    typeof candidate.sessionId === 'string' && candidate.sessionId.length > 0 && typeof candidate.pid === 'number' && Number.isInteger(candidate.pid) && candidate.pid > 0 &&
    typeof candidate.token === 'string' && candidate.token.length > 0 &&
    typeof candidate.startedAt === 'string' && Number.isFinite(Date.parse(candidate.startedAt)) &&
    typeof candidate.heartbeatAt === 'string' && Number.isFinite(Date.parse(candidate.heartbeatAt))
}

function sameLeaseOwner(left: WorkflowRunLease | undefined, right: Pick<WorkflowRunLease, 'runId' | 'sessionId' | 'token'>): left is WorkflowRunLease {
  return Boolean(isWorkflowLease(left) && left.runId === right.runId && left.sessionId === right.sessionId && left.token === right.token)
}

interface ApprovalFile {
  schemaVersion: 1
  projects: Record<string, string[]>
}

export class WorkflowApprovalStore {
  private readonly projectKey: string

  constructor(projectRoot: string, private readonly file = join(homedir(), '.deepseek', 'workflow-approvals.json')) {
    this.projectKey = hashWorkflowValue(resolve(projectRoot))
  }

  async isApproved(scriptHash: string): Promise<boolean> {
    const state = await readJson<ApprovalFile>(this.file)
    return state?.projects[this.projectKey]?.includes(scriptHash) ?? false
  }

  async approve(scriptHash: string): Promise<void> {
    await withApprovalFileLock(this.file, async () => {
      const state = await readJson<ApprovalFile>(this.file) ?? { schemaVersion: 1 as const, projects: {} }
      const hashes = state.projects[this.projectKey] ?? []
      if (!hashes.includes(scriptHash)) hashes.push(scriptHash)
      state.projects[this.projectKey] = hashes
      await atomicJson(this.file, state)
    })
  }
}
