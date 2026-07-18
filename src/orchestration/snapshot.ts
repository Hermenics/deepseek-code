import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { redactSecrets } from './events.js'
import { TASK_MESSAGE_SCHEMA, TASK_RECORD_SCHEMA, validateSchema, validateTaskResultEnvelope } from './schema.js'
import { TASK_STATES, type TaskMessageV1, type TaskRecordV1, type TaskSessionSnapshotV1 } from './types.js'

const SNAPSHOT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'sessionId', 'projectRoot', 'savedAt', 'tasks', 'messages'],
  properties: {
    schemaVersion: { const: 1 }, sessionId: { type: 'string', minLength: 1 },
    projectRoot: { type: 'string', minLength: 1 }, savedAt: { type: 'string', minLength: 1 },
    tasks: { type: 'array', items: TASK_RECORD_SCHEMA },
    messages: { type: 'array', items: TASK_MESSAGE_SCHEMA },
  },
} as const

function validateRecords(snapshot: TaskSessionSnapshotV1): void {
  const ids = new Set<string>()
  for (const record of snapshot.tasks) {
    if (record.schemaVersion !== 1 || record.sessionId !== snapshot.sessionId || !record.taskId) throw new Error('Snapshot contains an invalid task identity')
    if (!TASK_STATES.includes(record.state)) throw new Error(`Snapshot task '${record.taskId}' has invalid state '${record.state}'`)
    if (!Array.isArray(record.dependencies) || !Array.isArray(record.dependents) || !Array.isArray(record.artifactRefs)) throw new Error(`Snapshot task '${record.taskId}' has invalid graph fields`)
    const terminal = ['done', 'failed', 'cancelled', 'timed_out'].includes(record.state)
    if (terminal !== Boolean(record.result)) throw new Error(`Snapshot task '${record.taskId}' has inconsistent terminal result`)
    if (record.result) {
      const result = validateTaskResultEnvelope(record.result)
      if (!result.valid || record.result.taskId !== record.taskId || record.result.sessionId !== snapshot.sessionId || record.result.status !== record.state) {
        throw new Error(`Snapshot task '${record.taskId}' has an invalid result envelope`)
      }
    }
    if (record.workspace) {
      if (resolve(record.workspace.projectRoot) !== resolve(snapshot.projectRoot)) throw new Error(`Snapshot task '${record.taskId}' has a foreign workspace root`)
      const shared = record.workspace.isolation !== 'git-worktree'
      const worktreeRoot = resolve(snapshot.projectRoot, '.deepseek', 'worktrees')
      const workspacePath = resolve(record.workspace.path)
      if ((shared && workspacePath !== resolve(snapshot.projectRoot)) || (!shared && !workspacePath.startsWith(`${worktreeRoot}${sep}`))) {
        throw new Error(`Snapshot task '${record.taskId}' has an unsafe workspace path`)
      }
    }
    if (ids.has(record.taskId)) throw new Error(`Snapshot contains duplicate task '${record.taskId}'`)
    ids.add(record.taskId)
  }
  for (const record of snapshot.tasks) {
    for (const dependency of record.dependencies ?? []) if (!ids.has(dependency)) throw new Error(`Snapshot task '${record.taskId}' has missing dependency '${dependency}'`)
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const byId = new Map(snapshot.tasks.map(record => [record.taskId, record]))
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`Snapshot task graph contains a cycle at '${id}'`)
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of byId.get(id)?.dependencies ?? []) visit(dependency)
    visiting.delete(id); visited.add(id)
  }
  for (const id of ids) visit(id)
}

export class TaskSnapshotStore {
  private chain = Promise.resolve()
  lastError?: Error

  constructor(readonly file: string) {}

  static async read(file: string): Promise<TaskSessionSnapshotV1> {
    const parsed = JSON.parse(await readFile(resolve(file), 'utf8')) as unknown
    const validation = validateSchema<TaskSessionSnapshotV1>(SNAPSHOT_SCHEMA, parsed)
    if (!validation.valid || !validation.value) throw new Error(`Invalid task snapshot: ${validation.errors.join('; ')}`)
    validateRecords(validation.value)
    return validation.value
  }

  save(sessionId: string, projectRoot: string, tasks: TaskRecordV1[], messages: TaskMessageV1[]): void {
    const snapshot: TaskSessionSnapshotV1 = {
      schemaVersion: 1, sessionId, projectRoot, savedAt: new Date().toISOString(), tasks, messages,
    }
    const payload = `${JSON.stringify(redactSecrets(snapshot), null, 2)}\n`
    this.chain = this.chain.then(async () => {
      const target = resolve(this.file)
      const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
      await mkdir(dirname(target), { recursive: true })
      await writeFile(temporary, payload, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, target)
      this.lastError = undefined
    }).catch(error => { this.lastError = error instanceof Error ? error : new Error(String(error)) })
  }

  async flush(): Promise<void> {
    await this.chain
    if (this.lastError) throw this.lastError
  }
}
