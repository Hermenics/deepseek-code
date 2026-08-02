import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import type { WorkflowRpcUsage, WorkflowRun } from './types.js'

const MAX_REPLAY_RUNS = 100
const approvalFileLocks = new Map<string, Promise<void>>()

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

  constructor(readonly options: WorkflowStoreOptions) {
    const projectKey = hashWorkflowValue(resolve(options.projectRoot)).slice(0, 32)
    const sessionKey = hashWorkflowValue(options.sessionId).slice(0, 32)
    this.root = options.baseDirectory ?? join(homedir(), '.deepseek', 'projects', projectKey, sessionKey, 'workflows')
  }

  runDirectory(runId: string): string {
    return join(this.root, runId)
  }

  async createRun(run: WorkflowRun, script: string, args: unknown): Promise<void> {
    const directory = this.runDirectory(run.runId)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await Promise.all([
      privateText(join(directory, 'workflow.js'), script),
      atomicJson(join(directory, 'args.json'), args ?? {}),
      this.writeRun(run),
      this.writeJournal(run.runId, { schemaVersion: 1, scriptHash: run.scriptHash, argsHash: run.argsHash, optionsHash: run.optionsHash, entries: [] }),
    ])
  }

  async writeRun(run: WorkflowRun): Promise<void> {
    await atomicJson(join(this.runDirectory(run.runId), 'run.json'), run)
  }

  async readRun(runId: string): Promise<WorkflowRun | undefined> {
    return readJson<WorkflowRun>(join(this.runDirectory(runId), 'run.json'))
  }

  async readScript(runId: string): Promise<string | undefined> {
    try { return await readFile(join(this.runDirectory(runId), 'workflow.js'), 'utf8') } catch { return undefined }
  }

  async readArgs(runId: string): Promise<unknown> {
    return (await readJson(join(this.runDirectory(runId), 'args.json'))) ?? {}
  }

  async writeJournal(runId: string, journal: WorkflowJournal): Promise<void> {
    await atomicJson(join(this.runDirectory(runId), 'journal.json'), journal)
  }

  async readJournal(runId: string): Promise<WorkflowJournal | undefined> {
    return readJson<WorkflowJournal>(join(this.runDirectory(runId), 'journal.json'))
  }

  async listRuns(): Promise<WorkflowRun[]> {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(() => [])
    const runs = (await Promise.all(entries.filter(entry => entry.isDirectory()).map(entry => this.readRun(entry.name))))
      .filter((run): run is WorkflowRun => Boolean(run))
    return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_REPLAY_RUNS)
  }

  async findReplay(scriptHash: string, argsHash: string, optionsHash: string, excludeRunId?: string): Promise<WorkflowJournal | undefined> {
    let best: WorkflowJournal | undefined
    let bestPrefix = -1
    for (const run of await this.listRuns()) {
      if (run.runId === excludeRunId || run.scriptHash !== scriptHash || run.argsHash !== argsHash || run.optionsHash !== optionsHash || ['queued', 'running', 'paused'].includes(run.status)) continue
      const journal = await this.readJournal(run.runId)
      if (!journal || journal.scriptHash !== scriptHash || journal.argsHash !== argsHash || journal.optionsHash !== optionsHash ||
          !Array.isArray(journal.entries) || !journal.entries.every(entry => entry && typeof entry === 'object')) continue
      const prefix = journal.entries.findIndex(entry => entry.status !== 'completed')
      const length = prefix < 0 ? journal.entries.length : prefix
      if (prefix < 0) return journal
      if (length > bestPrefix) { best = journal; bestPrefix = length }
    }
    return best
  }
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
