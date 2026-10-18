import type { ChildProcess } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'
import { captureProcess, isProcessActive, observeProcess, type ProcessIdentity } from './processIdentity.js'
import { createHash, randomUUID } from 'node:crypto'
import { TaskEventSink } from './events.js'
import { TaskMailbox } from './mailbox.js'
import { canTransition, InvalidTaskTransitionError, normalizeTaskLimits, TaskRuntimeError, TERMINAL_TASK_STATES as TERMINAL } from './lifecycle.js'
import { createFailureEnvelope, enforceTaskBudget, normalizeTaskResult, toTaskError } from './result.js'
import { deferred, type TaskSlot } from './runtimeSlot.js'
import { TaskAggregateBudget, type AggregateBudgetLease } from './aggregateBudget.js'
import { validateRestoredTaskRecord } from './schema.js'
import { signalProcessGroupId } from '../utils/processGroup.js'
import { redactSecrets } from './events.js'
import {
  DEFAULT_TASK_LIMITS, type SpawnTaskInput, type TaskErrorV1, type TaskHandle, type TaskLimits,
  type TaskArtifactV1, type TaskEffectAggregateV1, type TaskEffectAttemptV1, type TaskEffectReconciliationV1, type TaskEffectResolution, type TaskMessageType, type TaskMessageV1, type TaskRecordV1, type TaskResultEnvelopeV1,
  type TaskRunner, type TaskRunnerResolver, type TaskState, type TaskWorkspaceV1,
} from './types.js'

const RETRY_CIRCUIT_BREAKER_THRESHOLD = 3
const TASK_EFFECT_LEDGER_MAX = 128
const PROCESS_HEARTBEAT_MS = 5_000
const PROCESS_TERMINATION_GRACE_MS = 1_000

export interface TaskRegistryOptions {
  sessionId?: string
  projectRoot: string
  limits?: Partial<TaskLimits>
  events?: TaskEventSink
  mailbox?: TaskMailbox
  persistEffectMarker?: () => Promise<void>
  persistReconciliation?: () => Promise<void>
}
/** Owns task records and runs them: enforces task-count, depth and fan-out limits, schedules queued tasks up to the concurrency limit, and handles timeouts, retries with exponential backoff, dependencies and cancellation cascades. */
export class TaskRegistry {
  readonly sessionId: string
  projectRoot: string
  readonly events: TaskEventSink
  readonly mailbox: TaskMailbox
  private limits: TaskLimits
  private readonly tasks = new Map<string, TaskSlot<unknown>>()
  private readonly restoredEffectCoverage = new WeakMap<TaskRecordV1, { state: TaskState; attempt: number; policy: TaskRecordV1['effectPolicy'] }>()
  private readonly queue: string[] = []
  private queued = new Set<string>()
  private active = 0
  private draining = false
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly retryFailures = new Map<string, { code: string; message: string; cause?: string; partial: unknown; count: number }>()
  private readonly aggregateBudgets = new Map<string, TaskAggregateBudget>()
  private readonly effectPropagationChains = new Map<string, Promise<void>>()
  private effectPropagationPending = 0
  private readonly persistEffectMarker?: () => Promise<void>
  private readonly persistReconciliation?: () => Promise<void>
  constructor(options: TaskRegistryOptions) {
    this.sessionId = options.sessionId ?? randomUUID()
    this.projectRoot = options.projectRoot
    this.limits = normalizeTaskLimits({ ...DEFAULT_TASK_LIMITS, ...options.limits })
    this.events = options.events ?? new TaskEventSink(this.sessionId)
    this.mailbox = options.mailbox ?? new TaskMailbox()
    this.persistEffectMarker = options.persistEffectMarker
    this.persistReconciliation = options.persistReconciliation
  }
  /** Merge new limits and reschedule so a raised concurrency takes effect immediately. */
  updateLimits(values: Partial<TaskLimits>): void { this.limits = normalizeTaskLimits({ ...this.limits, ...values }); this.scheduleDrain() }
  getLimits(): TaskLimits { return { ...this.limits } }
  private aggregateBudget(groupId: string): TaskAggregateBudget {
    let budget = this.aggregateBudgets.get(groupId)
    if (budget) return budget
    const limits = this.limits
    const records = this.listTasks().filter(record => record.budgetGroupId === groupId)
    budget = new TaskAggregateBudget(
      records.reduce((total, record) => total + (record.metrics.tokens ?? 0), 0),
      records.reduce((total, record) => total + (record.metrics.costUsd ?? 0), 0),
      (limits.maxAggregateTokens !== undefined || limits.maxAggregateCostUsd !== undefined)
        && records.some(record => record.error?.code === 'AGGREGATE_BUDGET_UNAVAILABLE'),
    )
    this.aggregateBudgets.set(groupId, budget)
    return budget
  }
  /** Reserve one serialized model request in a shared worker budget group. */
  async acquireAggregateBudget(groupId: string | undefined, signal?: AbortSignal): Promise<AggregateBudgetLease | undefined> {
    if (!groupId) return undefined
    return this.aggregateBudget(groupId).acquire(this.limits, signal)
  }
  /** Charge observed output bytes in the same per-turn pool used for serialized provider requests. */
  recordAggregateOutputBytes(groupId: string | undefined, bytes: number): boolean {
    if (!Number.isSafeInteger(bytes) || bytes < 0) return false
    return groupId ? this.aggregateBudget(groupId).recordOutputBytes(bytes) : true
  }
  /** Resolve once no task is running or in flight, polling once per macrotask. */
  async awaitIdle(): Promise<void> {
    while (this.active > 0 || this.effectPropagationPending > 0 || [...this.tasks.values()].some(slot => slot.inFlight)) await new Promise(resolve => setTimeout(resolve, 0))
  }
  /** Resolve when this task's subtree is terminal, no runner is still settling, and its effect receipts have propagated. */
  async awaitSubtreeSettled(taskId: string): Promise<void> {
    this.slot(taskId)
    while (true) {
      while (!this.isSubtreeClosed(taskId)) await new Promise(resolve => setTimeout(resolve, 0))
      const taskIds = this.subtreeTaskIds(taskId).join('\0')
      await this.queueEffectPropagation(taskId)
      if (this.isSubtreeClosed(taskId) && this.subtreeTaskIds(taskId).join('\0') === taskIds) return
    }
  }
  /** Create a task and queue it, or block it until its dependencies finish. Throws when task, depth, delegation or fan-out limits are exceeded, the ID exists or a dependency is unknown. */
  spawn<T>(input: SpawnTaskInput, runner: TaskRunner<T>): TaskHandle<T> {
    if (this.tasks.size >= this.limits.maxTasks) throw new TaskRuntimeError('TASK_LIMIT', `Task limit ${this.limits.maxTasks} reached`)
    const taskId = input.taskId ?? randomUUID()
    if (this.tasks.has(taskId)) throw new TaskRuntimeError('DUPLICATE_TASK', `Task '${taskId}' already exists`)
    const parent = input.parentTaskId ? this.slot(input.parentTaskId).record : undefined
    if (parent && input.budgetGroupId && input.budgetGroupId !== parent.budgetGroupId) {
      throw new TaskRuntimeError('BUDGET_GROUP_MISMATCH', `Child task '${taskId}' must inherit its parent's budget group`)
    }
    let parentEffectAttempt: number | undefined
    if (input.parentEffectId !== undefined) {
      if (input.parentEffectId.length < 1 || input.parentEffectId.length > 128 || !parent || parent.state !== 'running') {
        throw new TaskRuntimeError('PARENT_EFFECT_UNAVAILABLE', 'A parent effect link requires a running parent task and a bounded effect ID')
      }
      const parentEffect = parent.effectLedger?.find(effect => effect.id === input.parentEffectId && effect.attempt === parent.attempt)
      if (!parentEffect || parentEffect.state !== 'unknown') {
        throw new TaskRuntimeError('PARENT_EFFECT_UNAVAILABLE', 'The parent effect ID does not match an unresolved effect in the current attempt')
      }
      parentEffectAttempt = parentEffect.attempt
    }
    const budgetGroupId = parent?.budgetGroupId ?? input.budgetGroupId ?? taskId
    if (typeof budgetGroupId !== 'string' || !budgetGroupId.trim()) throw new TaskRuntimeError('INVALID_BUDGET_GROUP', 'Task budget group must be a non-empty ID')
    const depth = parent ? parent.depth + 1 : 0
    if (depth > this.limits.maxDepth) throw new TaskRuntimeError('DEPTH_LIMIT', `Task depth ${depth} exceeds limit ${this.limits.maxDepth}`)
    if (parent) {
      if (!parent.allowDelegation || parent.maxDepth <= 0) throw new TaskRuntimeError('DELEGATION_DENIED', `Task '${parent.taskId}' cannot delegate further`)
      const children = [...this.tasks.values()].filter(slot => slot.record.parentTaskId === parent.taskId).length
      const fanOutLimit = Math.min(this.limits.maxFanOut, parent.maxFanOut)
      if (children >= fanOutLimit) throw new TaskRuntimeError('FANOUT_LIMIT', `Task '${parent.taskId}' reached fan-out limit ${fanOutLimit}`)
    }
    const dependencies = [...new Set(input.dependencies ?? [])]
    for (const dependency of dependencies) {
      if (dependency === taskId) throw new TaskRuntimeError('TASK_CYCLE', `Task '${taskId}' cannot depend on itself`)
      this.slot(dependency)
    }
    const taskLimits = normalizeTaskLimits({ ...this.limits, maxTokens: input.maxTokens ?? this.limits.maxTokens, maxCostUsd: input.maxCostUsd ?? this.limits.maxCostUsd })
    const now = new Date().toISOString()
    const record: TaskRecordV1<T> = {
      schemaVersion: 1,
      taskId,
      sessionId: this.sessionId,
      parentTaskId: input.parentTaskId,
      parentEffectId: input.parentEffectId,
      parentEffectAttempt,
      budgetGroupId,
      type: input.type ?? 'agent',
      mode: input.mode ?? 'foreground',
      contextMode: input.contextMode ?? 'fresh',
      state: 'queued',
      depth,
      dependencies,
      dependents: [],
      createdAt: now,
      queuedAt: now,
      updatedAt: now,
      attempt: 0,
      maxRetries: this.clamp(input.maxRetries ?? this.limits.maxRetries, 0, 10),
      effectPolicy: input.effectPolicy === 'tool-gated' ? 'tool-gated' : 'unknown',
      timeoutMs: this.clamp(input.timeoutMs ?? this.limits.timeoutMs, 1, 86_400_000),
      maxDepth: this.clamp(input.maxDepth ?? (parent ? parent.maxDepth - 1 : this.limits.maxDepth), 0, 32),
      maxFanOut: this.clamp(input.maxFanOut ?? this.limits.maxFanOut, 1, 100),
      allowDelegation: input.allowDelegation ?? false,
      maxTokens: taskLimits.maxTokens,
      maxCostUsd: taskLimits.maxCostUsd,
      permissionProfile: input.permissionProfile ?? 'researcher-readonly',
      allowedTools: input.allowedTools,
      contextSummary: input.contextSummary,
      artifactRefs: [...(input.artifactRefs ?? [])],
      artifacts: [],
      metrics: { usageAvailable: false },
      metadata: structuredClone(input.metadata ?? {}),
      dependencyFailurePolicy: input.dependencyFailurePolicy ?? 'block',
      cancellationPolicy: input.cancellationPolicy ?? 'cascade',
    }
    const slot: TaskSlot<T> = { record, runner, completion: deferred() }
    this.tasks.set(taskId, slot as TaskSlot<unknown>)
    for (const dependency of dependencies) this.slot(dependency).record.dependents.push(taskId)
    this.events.emit('task_created', { state: record.state, mode: record.mode, depth, dependencies }, taskId, record.parentTaskId)

    if (dependencies.length > 0) this.evaluateDependencies(slot as TaskSlot<unknown>)
    if (record.state === 'queued') this.enqueue(taskId)
    return this.handle<T>(taskId)
  }
  getStatus<T = unknown>(taskId: string): TaskRecordV1<T> {
    const record = structuredClone(this.slot(taskId).record) as TaskRecordV1<T>
    if (record.process) record.process = observeProcess(record.process)
    return record
  }
  /** Return cloned records, optionally filtered by state and parent task. */
  listTasks(filter?: { state?: TaskState; parentTaskId?: string }): TaskRecordV1[] {
    return [...this.tasks.values()]
      .map(slot => slot.record)
      .filter(record => !filter?.state || record.state === filter.state)
      .filter(record => filter?.parentTaskId === undefined || record.parentTaskId === filter.parentTaskId)
      .map(record => this.getStatus(record.taskId))
  }
  /** Aggregate exact, durable positive receipts from this task and descendants. Empty results are not evidence of no effect. */
  getObservedEffectAggregate(taskId: string, expectedParentEffectId?: string): TaskEffectAggregateV1 {
    const root = this.slot(taskId).record
    let parentEffectIdMatches: boolean | undefined
    if (expectedParentEffectId !== undefined) {
      const parent = root.parentTaskId ? this.tasks.get(root.parentTaskId)?.record : undefined
      const parentEffect = parent && parent.effectLedger?.find(effect => effect.id === root.parentEffectId
        && effect.attempt === root.parentEffectAttempt && effect.attempt === parent.attempt)
      parentEffectIdMatches = root.parentEffectId === expectedParentEffectId
        && typeof root.parentEffectAttempt === 'number' && !!parentEffect
        && parentEffect.state !== 'no-effect'
    }
    const byParent = new Map<string, TaskRecordV1[]>()
    for (const { record } of this.tasks.values()) {
      if (!record.parentTaskId) continue
      const children = byParent.get(record.parentTaskId) ?? []
      children.push(record)
      byParent.set(record.parentTaskId, children)
    }

    const subtree: TaskRecordV1[] = []
    const pending = [root]
    const visited = new Set<string>()
    while (pending.length > 0) {
      const record = pending.pop()!
      if (visited.has(record.taskId)) continue
      visited.add(record.taskId)
      subtree.push(record)
      pending.push(...(byParent.get(record.taskId) ?? []))
    }

    const durable = this.persistEffectMarker !== undefined
    const observedEffects: TaskEffectAggregateV1['observedEffects'] = []
    const truncatedTaskIds: string[] = []
    const unclassifiedTaskIds: string[] = []
    const pendingTaskIds: string[] = []
    let unresolvedAttempts = 0
    for (const record of subtree) {
      if (record.effectLedgerTruncated) truncatedTaskIds.push(record.taskId)
      const restoredCoverage = this.restoredEffectCoverage.get(record)
      const effectPolicy = restoredCoverage?.state === record.state && restoredCoverage.attempt === record.attempt
        ? restoredCoverage.policy
        : record.effectPolicy
      if (effectPolicy !== 'tool-gated') unclassifiedTaskIds.push(record.taskId)
      if (!TERMINAL.has(record.state)) pendingTaskIds.push(record.taskId)
      const effectIds = new Map<string, number>()
      for (const effect of record.effectLedger ?? []) {
        const key = `${effect.attempt}:${effect.id}`
        effectIds.set(key, (effectIds.get(key) ?? 0) + 1)
      }
      for (const effect of record.effectLedger ?? []) {
        const hasExactOutcome = (effect.state === 'effect-observed' || effect.state === 'no-effect')
          && Number.isInteger(effect.attempt) && effect.attempt > 0 && effect.attempt <= record.attempt
          && typeof effect.id === 'string' && effect.id.length > 0
          && effectIds.get(`${effect.attempt}:${effect.id}`) === 1
          && typeof effect.tool === 'string' && effect.tool.length > 0
          && typeof effect.evidence === 'string' && effect.evidence.trim() === effect.evidence
          && effect.evidence.length > 0 && effect.evidence.length <= 256 && redactSecrets(effect.evidence) === effect.evidence
          && typeof effect.resolvedAt === 'string' && Number.isFinite(Date.parse(effect.resolvedAt))
        if (hasExactOutcome && durable && effect.state === 'effect-observed') {
          observedEffects.push({
            taskId: record.taskId,
            effectId: effect.id,
            attempt: effect.attempt,
            tool: effect.tool,
            evidenceSha256: createHash('sha256').update(effect.evidence!).digest('hex'),
            resolvedAt: effect.resolvedAt!,
          })
        } else if (!hasExactOutcome || !durable) {
          unresolvedAttempts++
        }
      }
    }
    observedEffects.sort((left, right) => left.taskId.localeCompare(right.taskId)
      || left.attempt - right.attempt || left.effectId.localeCompare(right.effectId))
    const aggregateEvidence = durable && observedEffects.length > 0
      && (expectedParentEffectId === undefined || parentEffectIdMatches === true)
      ? `descendant-effects-sha256:${createHash('sha256').update(JSON.stringify(observedEffects)).digest('hex')}`
      : undefined
    const allRecordedEffectsSettled = durable && unresolvedAttempts === 0
      && truncatedTaskIds.length === 0 && unclassifiedTaskIds.length === 0 && pendingTaskIds.length === 0
      && (expectedParentEffectId === undefined || parentEffectIdMatches === true)
    return {
      taskId,
      coverage: 'durable-positive-outcomes-only',
      durable,
      allRecordedEffectsSettled,
      ...(expectedParentEffectId !== undefined ? { parentEffectIdMatches } : {}),
      ...(aggregateEvidence ? { positiveEvidence: aggregateEvidence } : {}),
      observedEffects,
      unresolvedAttempts,
      truncatedTaskIds: truncatedTaskIds.sort(),
      unclassifiedTaskIds: unclassifiedTaskIds.sort(),
      pendingTaskIds: pendingTaskIds.sort(),
    }
  }
  /** Queued tasks whose dependencies are all done. */
  listReady(): TaskRecordV1[] { return this.listTasks({ state: 'queued' }).filter(record => this.dependenciesDone(record)) }
  /** Load snapshot records into an empty registry. Eligible running background Shell tasks reattach through their resolver; other interrupted processes fail closed, queued tasks without a runner are blocked, and remaining work is re-evaluated. */
  restoreTasks(records: TaskRecordV1[], resolver?: TaskRunnerResolver): void {
    if (this.tasks.size > 0) throw new TaskRuntimeError('RESTORE_NOT_EMPTY', 'Tasks can only be restored into an empty registry')
    if (records.length > this.limits.maxTasks) throw new TaskRuntimeError('TASK_LIMIT', `Snapshot exceeds task limit ${this.limits.maxTasks}`)
    const recordsById = new Map(records.map(record => [record.taskId, record]))
    const inferBudgetGroup = (record: TaskRecordV1): string => {
      let current = record
      const visited = new Set<string>()
      while (!current.budgetGroupId && current.parentTaskId) {
        if (visited.has(current.taskId)) throw new TaskRuntimeError('INVALID_SNAPSHOT', `Task parent cycle includes '${current.taskId}'`)
        visited.add(current.taskId)
        const parent = recordsById.get(current.parentTaskId)
        if (!parent) return record.taskId
        current = parent
      }
      return current.budgetGroupId ?? current.taskId
    }
    const unavailable: TaskRunner = async () => { throw new TaskRuntimeError('RUNNER_UNAVAILABLE', 'Task runner must be reattached after restart') }
    for (const source of records) {
      const validation = validateRestoredTaskRecord(source, this.sessionId)
      if (!validation.valid) throw new TaskRuntimeError('INVALID_SNAPSHOT', `Invalid restored task: ${validation.errors.join('; ')}`)
      if (source.sessionId !== this.sessionId || this.tasks.has(source.taskId)) throw new TaskRuntimeError('INVALID_SNAPSHOT', `Invalid restored task '${source.taskId}'`)
      const record = structuredClone(source)
      const historicalEffectPolicy = TERMINAL.has(record.state) && record.state !== 'done' ? record.effectPolicy : undefined
      const historicalEffectState = record.state
      const historicalEffectAttempt = record.attempt
      // A saved runner policy cannot certify the reattached implementation.
      if (record.state !== 'done') record.effectPolicy = 'unknown'
      if (record.effectLedgerTruncated || record.effectLedger?.some(effect => effect.attempt === record.attempt && effect.state !== 'no-effect')) {
        record.effectMayHaveStarted = true
      }
      const parent = record.parentTaskId ? recordsById.get(record.parentTaskId) : undefined
      const expectedBudgetGroupId = parent ? inferBudgetGroup(parent) : record.budgetGroupId ?? record.taskId
      if (record.budgetGroupId && parent && record.budgetGroupId !== expectedBudgetGroupId) {
        throw new TaskRuntimeError('INVALID_SNAPSHOT', `Task '${record.taskId}' does not inherit its parent's budget group`)
      }
      record.budgetGroupId ??= expectedBudgetGroupId
      record.dependents = []
      record.artifacts ??= structuredClone(record.result?.artifacts ?? [])
      record.artifactRefs = [...new Set([...record.artifactRefs, ...record.artifacts.map(artifact => artifact.id)])]
      const runner = resolver?.(structuredClone(record))
      const reattachProcess = record.state === 'running' && record.type === 'shell' && record.metadata.shellBackground === true
        && !!record.process?.identity && !!runner
      if (reattachProcess) {
        const remaining = record.deadline ? Date.parse(record.deadline) - Date.now() : record.timeoutMs
        record.timeoutMs = Math.max(1, Math.min(record.timeoutMs, Number.isFinite(remaining) ? remaining : record.timeoutMs))
        record.state = 'queued'
        record.error = undefined
        record.result = undefined
        record.completedAt = undefined
        record.deadline = undefined
      } else if (record.state === 'running' || record.process && ['queued', 'blocked'].includes(record.state)) {
        const error: TaskErrorV1 = { code: 'INTERRUPTED', message: 'Executor connection was lost while this attempt was running; process state and effects require reconciliation', retryable: false }
        record.state = 'failed'; record.error = error; record.completedAt = new Date().toISOString(); record.deadline = undefined
        record.result = {
          schemaVersion: 1, taskId: record.taskId, sessionId: this.sessionId, status: 'failed',
          partial: record.partial ?? record.result?.partial, artifacts: record.artifacts, metrics: record.metrics,
          error, completedAt: record.completedAt,
        }
      } else if (record.state === 'queued' && !runner) {
        record.state = 'blocked'; record.blockReason = 'Runner unavailable after restart'
      }
      const slot: TaskSlot = { record, runner: runner ?? unavailable, completion: deferred(), ...(reattachProcess ? { reattachProcess: true } : {}) }
      this.tasks.set(record.taskId, slot)
      if (historicalEffectPolicy === 'tool-gated') {
        this.restoredEffectCoverage.set(record, {
          state: historicalEffectState, attempt: historicalEffectAttempt, policy: historicalEffectPolicy,
        })
      }
      if (TERMINAL.has(record.state) && record.result) slot.completion.resolve(record.result)
    }
    for (const slot of this.tasks.values()) {
      for (const dependency of slot.record.dependencies) this.slot(dependency).record.dependents.push(slot.record.taskId)
    }
    for (const slot of this.tasks.values()) {
      if (slot.record.state === 'queued') {
        this.evaluateDependencies(slot)
        if (slot.record.state === 'queued') this.enqueue(slot.record.taskId)
      }
      else if (slot.record.state === 'blocked' && slot.runner !== unavailable) this.evaluateDependencies(slot)
      const process = slot.record.process
      if (process?.identity) {
        const observation = observeProcess(process)
        slot.record.process = observation
        slot.record.updatedAt = observation.observedAt
        this.events.emit('process_observed', { process: observation }, slot.record.taskId, slot.record.parentTaskId)
        if (isProcessActive(observation)) this.startProcessHeartbeat(slot, slot.record.attempt, process.identity)
      }
    }
    for (const slot of this.tasks.values()) {
      if (TERMINAL.has(slot.record.state)) this.queueEffectPropagation(slot.record.taskId)
    }
  }
  /** Set a task's runner (e.g. after restore); a task blocked for lack of a runner is re-queued. */
  attachRunner(taskId: string, runner: TaskRunner): void {
    const slot = this.slot(taskId)
    slot.runner = runner
    if (slot.record.state === 'blocked' && slot.record.blockReason === 'Runner unavailable after restart') {
      slot.record.blockReason = undefined
      this.transition(slot, 'queued', 'resume')
      this.evaluateDependencies(slot)
      if (this.slot(taskId).record.state === 'queued') this.enqueue(taskId)
    } else if (slot.record.state === 'blocked') this.evaluateDependencies(slot)
  }
  /** Resolve with a clone of the task's result envelope once it reaches a terminal state. */
  awaitResult<T = unknown>(taskId: string): Promise<TaskResultEnvelopeV1<T>> {
    const slot = this.slot(taskId) as TaskSlot<T>
    if (slot.record.result && TERMINAL.has(slot.record.state)) return Promise.resolve(structuredClone(slot.record.result))
    return slot.completion.promise.then(result => structuredClone(result))
  }
  getResult<T = unknown>(taskId: string): TaskResultEnvelopeV1<T> | undefined {
    const result = (this.slot(taskId) as TaskSlot<T>).record.result
    return result ? structuredClone(result) : undefined
  }
  /** Cancel an unfinished task: clear its retry timer, abort the running attempt, settle it as cancelled, cascade to children with the cascade policy and re-evaluate dependents. Returns false if it already ended in another terminal state. */
  cancel(taskId: string, reason = 'Cancelled by coordinator'): boolean {
    const slot = this.slot(taskId)
    if (slot.record.state === 'cancelled') return true
    if (TERMINAL.has(slot.record.state)) return false
    const retryTimer = this.retryTimers.get(taskId)
    if (retryTimer) {
      clearTimeout(retryTimer)
      this.retryTimers.delete(taskId)
    }
    slot.controller?.abort(new TaskRuntimeError('CANCELLED', reason))
    const envelope = this.finish(slot, 'cancelled', undefined, { code: 'CANCELLED', message: reason, retryable: false })
    slot.completion.resolve(envelope)
    this.events.emit('cancelled', { reason }, taskId, slot.record.parentTaskId)
    if (slot.record.cancellationPolicy === 'cascade') {
      for (const child of this.childrenOf(taskId)) {
        if (child.cancellationPolicy === 'cascade') this.cancel(child.taskId, `Parent task '${taskId}' was cancelled`)
      }
    }
    this.notifyDependents(taskId)
    if (!slot.inFlight) this.scheduleEffectPropagation(taskId)
    return true
  }
  /** Stop a freshly revalidated Linux group, escalating from SIGTERM to SIGKILL; interrupted effects remain unreconciled. */
  async requestInterruptedProcessTermination(taskId: string): Promise<'stopped' | 'still-active' | 'not-active' | 'not-safe'> {
    const slot = this.slot(taskId)
    const record = slot.record
    const previous = record.process
    if (record.state !== 'failed' || !['INTERRUPTED', 'PROCESS_STILL_ACTIVE'].includes(record.error?.code ?? '') || !previous) return 'not-safe'
    const observe = () => {
      const observation = observeProcess(record.process!)
      record.process = observation
      record.updatedAt = observation.observedAt
      return observation
    }
    const publish = (observation: ReturnType<typeof observeProcess>) => this.events.emit('process_observed', { process: observation }, record.taskId, record.parentTaskId)
    const canSignal = (observation: ReturnType<typeof observeProcess>) => {
      const identity = observation.identity
      return process.platform === 'linux' && !!identity && identity.platform === 'linux' && identity.sessionId !== undefined
        && observation.provenance !== 'unavailable' && observation.scope === 'process-group'
        && identity.pid >= 2 && identity.processGroupId === identity.pid
        && observation.processGroup?.id === identity.pid && observation.processGroup.status === 'alive'
        && observation.status !== 'unknown' && observation.status !== 'identity-mismatch' && observation.processGroup.memberCount !== 0
    }
    let current = observe()
    publish(current)
    if (!isProcessActive(current)) return 'not-active'
    const identity = current.identity
    if (!canSignal(current) || !identity) return 'not-safe'
    // shortcut: PGID can change after /proc validation; upgrade to supervisor-owned cgroups if atomic ownership is required.
    if (!signalProcessGroupId(identity.pid, 'SIGTERM')) {
      current = observe()
      publish(current)
      return isProcessActive(current) ? 'not-safe' : 'not-active'
    }
    const termDeadline = Date.now() + PROCESS_TERMINATION_GRACE_MS
    while (Date.now() < termDeadline) {
      await new Promise(resolve => setTimeout(resolve, 25))
      current = observe()
      if (!isProcessActive(current)) { publish(current); return 'stopped' }
      if (!canSignal(current)) { publish(current); return 'not-safe' }
    }
    current = observe()
    if (!isProcessActive(current)) { publish(current); return 'stopped' }
    if (!canSignal(current) || !signalProcessGroupId(identity.pid, 'SIGKILL')) {
      current = observe()
      publish(current)
      return isProcessActive(current) ? 'still-active' : 'stopped'
    }
    const killDeadline = Date.now() + 500
    while (Date.now() < killDeadline) {
      await new Promise(resolve => setTimeout(resolve, 25))
      current = observe()
      if (!isProcessActive(current)) { publish(current); return 'stopped' }
    }
    publish(current)
    return 'still-active'
  }
  cancelAll(reason = 'Session cancelled'): void {
    for (const record of this.listTasks()) if (!TERMINAL.has(record.state)) this.cancel(record.taskId, reason)
  }
  /** Re-queue a blocked or unsuccessfully finished task, clearing its result and error. Finished tasks can only resume while retry attempts remain. */
  resume(taskId: string): boolean {
    const slot = this.slot(taskId)
    if (!['blocked', 'failed', 'cancelled', 'timed_out'].includes(slot.record.state)) return false
    if (slot.reconciliationPending) throw new TaskRuntimeError('RECONCILIATION_PENDING', 'Task effect reconciliation is still being saved')
    const record = slot.record
    const reconciliation = record.effectReconciliations?.at(-1)
    const reconciledCurrentAttempt = reconciliation?.attempt === record.attempt && reconciliation.resolution === 'no-effect'
    const currentEffects = record.effectLedger?.filter(effect => effect.attempt === record.attempt) ?? []
    const verifiedNoEffect = !record.effectLedgerTruncated && currentEffects.length > 0 && currentEffects.every(effect => effect.state === 'no-effect')
    if (record.process) {
      record.process = observeProcess(record.process)
      if (isProcessActive(record.process)) throw new TaskRuntimeError('PROCESS_STILL_ACTIVE', 'Task process state is still active or unknown; stop and inspect it before retrying. Once settled, reconcile effects before resuming.')
    }
    if (record.error?.code === 'INTERRUPTED' && !record.process) {
      throw new TaskRuntimeError('PROCESS_STATE_UNVERIFIED', 'This interrupted attempt has no captured process identity, so its previous runner may still be active. Inspect and reconcile effects only after process settlement is verified; this attempt cannot be resumed safely.')
    }
    const requiresReconciliation = Boolean(record.process || record.error?.code === 'INTERRUPTED' || record.effectMayHaveStarted && !verifiedNoEffect)
    if (requiresReconciliation && !reconciledCurrentAttempt) {
      throw new TaskRuntimeError('RECONCILIATION_REQUIRED', 'Task may have started external effects. Use /task <id> reconcile no-effect|effect-observed|compensated <evidence> to reconcile effects; only a verified no-effect result permits resuming this attempt.')
    }
    this.retryFailures.delete(taskId)
    const wasBlocked = slot.record.state === 'blocked'
    if (!wasBlocked && slot.record.attempt >= slot.record.maxRetries + 1) return false
    if (!wasBlocked) slot.completion = deferred()
    if (reconciledCurrentAttempt || verifiedNoEffect) {
      record.effectMayHaveStarted = false
      record.process = undefined
    }
    slot.record.result = undefined
    slot.record.error = undefined
    slot.record.blockReason = undefined
    this.transition(slot, 'queued', 'resume')
    this.evaluateDependencies(slot)
    if (slot.record.state === 'queued') this.enqueue(taskId)
    return true
  }
  /** Store a user's durable review of a stopped attempt; only `no-effect` authorizes resuming that exact attempt. */
  async reconcileEffects(taskId: string, resolution: TaskEffectResolution, evidence: string): Promise<TaskEffectReconciliationV1> {
    const slot = this.slot(taskId)
    const record = slot.record
    if (slot.reconciliationPending) throw new TaskRuntimeError('RECONCILIATION_PENDING', 'Task effect reconciliation is already being saved')
    if (!['done', 'failed', 'cancelled', 'timed_out'].includes(record.state)) throw new TaskRuntimeError('TASK_NOT_STOPPED', 'Only stopped tasks can be reconciled')
    if (slot.inFlight) throw new TaskRuntimeError('TASK_STILL_SETTLING', 'The task runner is still settling; wait for it to stop before reconciling effects')
    if (!record.effectMayHaveStarted && !record.process && record.error?.code !== 'INTERRUPTED') {
      throw new TaskRuntimeError('NO_UNCERTAIN_EFFECT', 'This task has no recorded uncertain effect to reconcile')
    }
    if (!['no-effect', 'effect-observed', 'compensated'].includes(resolution)) throw new TaskRuntimeError('INVALID_RECONCILIATION', 'Choose no-effect, effect-observed, or compensated')
    if (typeof evidence !== 'string' || !evidence.trim() || evidence.trim().length > 2_000) {
      throw new TaskRuntimeError('INVALID_RECONCILIATION_EVIDENCE', 'Reconciliation evidence must contain 1–2000 characters')
    }
    const normalizedEvidence = evidence.trim()
    if (redactSecrets(normalizedEvidence) !== normalizedEvidence) {
      throw new TaskRuntimeError('RECONCILIATION_SECRET', 'Reconciliation evidence cannot contain credentials')
    }
    if (!this.persistReconciliation) {
      throw new TaskRuntimeError('RECONCILIATION_STORAGE_UNAVAILABLE', 'A durable task snapshot is required to record reconciliation')
    }
    const observedProcess = record.process ? observeProcess(record.process) : undefined
    if (observedProcess && isProcessActive(observedProcess)) {
      throw new TaskRuntimeError('PROCESS_STILL_ACTIVE', 'Task process state is still active or unknown; stop and inspect it before reconciling')
    }
    if (resolution === 'no-effect' && record.error?.code === 'INTERRUPTED' && !observedProcess) {
      throw new TaskRuntimeError('PROCESS_STATE_UNVERIFIED', 'Cannot record no-effect for an interrupted task without a captured process identity and verified process settlement')
    }
    const reconciliation: TaskEffectReconciliationV1 = {
      attempt: record.attempt,
      resolution,
      evidence: normalizedEvidence,
      actor: 'user',
      reconciledAt: new Date().toISOString(),
      ...(observedProcess ? { processSettledAt: observedProcess.observedAt } : {}),
    }
    const previous = record.effectReconciliations
    const previousUpdatedAt = record.updatedAt
    slot.reconciliationPending = true
    record.process = observedProcess
    record.effectReconciliations = [...(previous ?? []), reconciliation].slice(-16)
    record.updatedAt = reconciliation.reconciledAt
    try {
      await this.persistReconciliation()
    } catch (error) {
      record.effectReconciliations = previous
      record.updatedAt = previousUpdatedAt
      throw new TaskRuntimeError('RECONCILIATION_PERSIST_FAILED', `Could not durably save effect reconciliation: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      slot.reconciliationPending = false
    }
    this.events.emit('effect_reconciled', {
      attempt: reconciliation.attempt, resolution, evidence: normalizedEvidence, actor: 'user',
      processSettledAt: reconciliation.processSettledAt,
    }, taskId, record.parentTaskId)
    return structuredClone(reconciliation)
  }
  /** Move a queued or running task to blocked, aborting a running attempt with a retryable BLOCKED error. */
  block(taskId: string, reason: string): boolean {
    const slot = this.slot(taskId)
    if (!['queued', 'running'].includes(slot.record.state)) return false
    this.retryFailures.delete(taskId)
    slot.controller?.abort(new TaskRuntimeError('BLOCKED', reason, true))
    slot.record.blockReason = reason
    this.transition(slot, 'blocked')
    this.events.emit('blocked', { reason }, taskId, slot.record.parentTaskId)
    return true
  }
  /** Add a dependency edge at runtime; throws on a cycle or when the task is running or finished. */
  addDependency(taskId: string, dependencyId: string): void {
    const slot = this.slot(taskId)
    const dependency = this.slot(dependencyId)
    if (taskId === dependencyId || this.reaches(dependencyId, taskId)) throw new TaskRuntimeError('TASK_CYCLE', `Adding '${dependencyId}' creates a cycle`)
    if (slot.record.dependencies.includes(dependencyId)) return
    if (slot.record.state === 'running' || TERMINAL.has(slot.record.state)) throw new TaskRuntimeError('TASK_ACTIVE', `Cannot change dependencies for '${taskId}' in state ${slot.record.state}`)
    slot.record.dependencies.push(dependencyId)
    dependency.record.dependents.push(taskId)
    this.evaluateDependencies(slot)
  }
  /** Store a mailbox message for a task and emit a message event unless it is a duplicate resend. */
  sendMessage(
    taskId: string,
    type: TaskMessageType,
    payload: Record<string, unknown>,
    recipientId = taskId,
    senderId = 'coordinator',
    messageId?: string,
  ): TaskMessageV1 {
    this.slot(taskId)
    const { message, duplicate } = this.mailbox.send({ messageId, senderId, recipientId, type, taskId, payload })
    if (!duplicate) this.events.emit('message', { message }, taskId, undefined, message.correlationId)
    return message
  }
  /** Record the task's workspace and emit workspace_updated. */
  setWorkspace(taskId: string, workspace: TaskWorkspaceV1): void {
    const slot = this.slot(taskId)
    slot.record.workspace = structuredClone(workspace)
    slot.record.updatedAt = new Date().toISOString()
    this.events.emit('workspace_updated', { workspace: slot.record.workspace }, taskId, slot.record.parentTaskId)
  }
  /** Remove the task's workspace and emit workspace_updated with null. */
  clearWorkspace(taskId: string): void {
    const slot = this.slot(taskId)
    slot.record.workspace = undefined
    slot.record.updatedAt = new Date().toISOString()
    this.events.emit('workspace_updated', { workspace: null }, taskId, slot.record.parentTaskId)
  }
  /** Shallow-merge metadata into the task record and emit metadata_updated. */
  updateMetadata(taskId: string, metadata: Record<string, unknown>): void {
    const slot = this.slot(taskId)
    slot.record.metadata = { ...slot.record.metadata, ...structuredClone(metadata) }
    slot.record.updatedAt = new Date().toISOString()
    this.events.emit('metadata_updated', { metadata }, taskId, slot.record.parentTaskId)
  }

  /** Shallow-merge metrics into the task record and emit metrics_updated. */
  updateMetrics(taskId: string, metrics: Partial<TaskRecordV1['metrics']>): void {
    const slot = this.slot(taskId)
    slot.record.metrics = { ...slot.record.metrics, ...metrics }
    slot.record.updatedAt = new Date().toISOString()
    this.events.emit('metrics_updated', { metrics: slot.record.metrics }, taskId, slot.record.parentTaskId)
  }

  /** Add one observed model response to task totals so retries cannot erase previously measured usage. */
  recordModelUsage(taskId: string, sample: TaskRecordV1['metrics']): void {
    const slot = this.slot(taskId)
    const previous = slot.record.metrics
    const hadUsage = previous.tokens !== undefined
    const hadCost = previous.costUsd !== undefined
    slot.record.metrics = {
      ...previous,
      model: sample.model ?? previous.model,
      provider: sample.provider ?? previous.provider,
      tokens: (previous.tokens ?? 0) + (sample.tokens ?? 0),
      costUsd: (previous.costUsd ?? 0) + (sample.costUsd ?? 0),
      promptTokens: (previous.promptTokens ?? 0) + (sample.promptTokens ?? 0),
      completionTokens: (previous.completionTokens ?? 0) + (sample.completionTokens ?? 0),
      cachedTokens: (previous.cachedTokens ?? 0) + (sample.cachedTokens ?? 0),
      usageAvailable: hadUsage ? previous.usageAvailable && sample.usageAvailable : sample.usageAvailable,
      costAvailable: hadCost ? (previous.costAvailable ?? true) && (sample.costAvailable ?? false) : sample.costAvailable ?? false,
    }
    slot.record.updatedAt = new Date().toISOString()
    this.events.emit('metrics_updated', { metrics: slot.record.metrics }, taskId, slot.record.parentTaskId)
  }

  /** Attach a task-produced artifact to the recoverable result and persist its reference on the task record. */
  recordArtifact(taskId: string, artifact: TaskArtifactV1): void {
    const slot = this.slot(taskId)
    if (typeof artifact.id !== 'string' || !artifact.id.trim() || !['file', 'patch', 'log', 'result', 'other'].includes(artifact.kind)) {
      throw new TaskRuntimeError('INVALID_ARTIFACT', 'Task artifact requires a non-empty ID and supported kind')
    }
    const copy = structuredClone(artifact)
    const existing = slot.record.artifacts?.find(item => item.id === copy.id)
    if (existing && JSON.stringify(existing) !== JSON.stringify(copy)) throw new TaskRuntimeError('ARTIFACT_COLLISION', `Task artifact '${copy.id}' was recorded with different metadata`)
    if (existing) return
    slot.record.artifacts ??= []
    slot.record.artifacts.push(copy)
    if (!slot.record.artifactRefs.includes(copy.id)) slot.record.artifactRefs.push(copy.id)
    if (slot.record.result) slot.record.result.artifacts = structuredClone(slot.record.artifacts)
    slot.record.updatedAt = new Date().toISOString()
    this.events.emit('artifact_recorded', { artifact: copy }, taskId, slot.record.parentTaskId)
  }

  /** Update recovery evidence after an interrupted attempt is inspected; never makes the task runnable again. */
  updateInterruptedPartial(taskId: string, partial: unknown): boolean {
    const slot = this.slot(taskId)
    if (slot.record.state !== 'failed' || slot.record.error?.code !== 'INTERRUPTED' || !slot.record.result) return false
    slot.partial = structuredClone(partial)
    slot.record.partial = structuredClone(partial)
    slot.record.result.partial = structuredClone(partial)
    slot.record.updatedAt = new Date().toISOString()
    this.events.emit('partial_updated', { partial: slot.record.partial }, taskId, slot.record.parentTaskId)
    return true
  }

  /** Mark a message processed, emitting an event only on the first acknowledgement. */
  acknowledgeMessage(messageId: string): boolean {
    const message = this.mailbox.list().find(candidate => candidate.messageId === messageId)
    const acknowledged = this.mailbox.acknowledge(messageId)
    if (acknowledged && message && message.status !== 'processed') this.events.emit('message', { messageId, status: 'processed' }, message.taskId, undefined, message.correlationId)
    return acknowledged
  }

  /** Manual non-terminal state change; terminal states go through the run/cancel paths so a result envelope is always recorded. */
  transitionTask(taskId: string, state: TaskState): void {
    const slot = this.slot(taskId)
    if (TERMINAL.has(state)) throw new InvalidTaskTransitionError(taskId, slot.record.state, state)
    this.transition(slot, state)
  }

  /** Build the TaskHandle returned to callers, bound to this task ID. */
  private handle<T>(taskId: string): TaskHandle<T> {
    return {
      taskId,
      sessionId: this.sessionId,
      status: () => this.getStatus<T>(taskId),
      awaitResult: () => this.awaitResult<T>(taskId),
      cancel: reason => this.cancel(taskId, reason),
      sendMessage: (type, payload, recipientId, messageId) => this.sendMessage(taskId, type, payload, recipientId, 'coordinator', messageId),
      resume: () => this.resume(taskId),
      getResult: () => this.getResult<T>(taskId),
    }
  }

  /** Add a task to the run queue unless it is already queued or has an attempt in flight. */
  private enqueue(taskId: string): void {
    if (this.queued.has(taskId)) return
    if (this.slot(taskId).inFlight) return
    this.queued.add(taskId)
    this.queue.push(taskId)
    this.scheduleDrain()
  }

  /** On the next microtask, start queued tasks up to the concurrency limit, skipping entries that are no longer runnable. Repeated calls before then collapse into one drain. */
  private scheduleDrain(): void {
    if (this.draining) return
    this.draining = true
    queueMicrotask(() => {
      this.draining = false
      while (this.active < this.limits.concurrency && this.queue.length > 0) {
        const taskId = this.queue.shift()!
        this.queued.delete(taskId)
        const slot = this.tasks.get(taskId)
        if (!slot || slot.record.state !== 'queued' || !this.dependenciesDone(slot.record)) continue
        this.active++
        void this.run(slot).finally(() => {
          this.active--
          this.scheduleDrain()
        })
      }
    })
  }

  /** Execute one attempt: transition to running, race the runner against the abort signal (timeout, cancel, block), then record success or route the error to timed_out, cancelled, blocked, a backoff retry or failed. Outcomes of superseded attempts are ignored. */
  private async run(slot: TaskSlot<unknown>): Promise<void> {
    const record = slot.record
    slot.inFlight = true
    const reattachProcess = slot.reattachProcess === true
    slot.reattachProcess = false
    if (!reattachProcess) {
      slot.partial = undefined
      record.partial = undefined
      record.process = undefined
    }
    record.attempt++
    const attempt = record.attempt
    record.startedAt = new Date().toISOString()
    record.deadline = new Date(Date.now() + record.timeoutMs).toISOString()
    const controller = new AbortController()
    slot.controller = controller
    this.transition(slot, 'running')
    this.events.emit('attempt_started', { attempt, deadline: record.deadline }, record.taskId, record.parentTaskId)
    const started = Date.now()
    const timeoutError = new TaskRuntimeError('TIMED_OUT', `Task timed out after ${record.timeoutMs}ms`, true)
    const timeout = setTimeout(() => controller.abort(timeoutError), record.timeoutMs)
    const aborted = new Promise<never>((_, reject) => {
      if (controller.signal.aborted) reject(controller.signal.reason)
      else controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
    })

    let runnerPromise: Promise<unknown> | undefined
    const markEffectStarted = async (tool: string): Promise<string> => {
      if (record.attempt !== attempt || !slot.inFlight) throw new TaskRuntimeError('STALE_EFFECT_ATTEMPT', 'Task effect marker belongs to a stopped attempt')
      const effectId = randomUUID()
      const previousEffects = record.effectLedger ? [...record.effectLedger] : undefined
      const previousTruncated = record.effectLedgerTruncated
      const previousEffectMayHaveStarted = record.effectMayHaveStarted
      const previousUpdatedAt = record.updatedAt
      const entry: TaskEffectAttemptV1 = { id: effectId, attempt, tool, state: 'unknown', startedAt: new Date().toISOString() }
      if ((record.effectLedger?.length ?? 0) < TASK_EFFECT_LEDGER_MAX) record.effectLedger = [...(record.effectLedger ?? []), entry]
      else record.effectLedgerTruncated = true
      record.effectMayHaveStarted = true
      record.updatedAt = entry.startedAt
      try {
        await Promise.race([Promise.resolve().then(() => this.persistEffectMarker?.()), aborted])
      } catch (error) {
        record.effectLedger = previousEffects
        record.effectLedgerTruncated = previousTruncated
        record.effectMayHaveStarted = previousEffectMayHaveStarted
        record.updatedAt = previousUpdatedAt
        throw error
      }
      this.events.emit('effect_started', { tool, effectId, attempt }, record.taskId, record.parentTaskId)
      return effectId
    }
    const markEffectOutcome = async (effectId: string, state: 'no-effect' | 'effect-observed', evidence: string): Promise<void> => {
      if (record.attempt !== attempt || !slot.inFlight) throw new TaskRuntimeError('STALE_EFFECT_ATTEMPT', 'Task effect outcome belongs to a stopped attempt')
      const index = record.effectLedger?.findIndex(effect => effect.id === effectId && effect.attempt === attempt) ?? -1
      if (index < 0) return // The ledger overflowed; the task remains fail-closed.
      const normalizedEvidence = evidence.trim()
      if (!normalizedEvidence || normalizedEvidence.length > 256 || redactSecrets(normalizedEvidence) !== normalizedEvidence) {
        throw new TaskRuntimeError('INVALID_EFFECT_EVIDENCE', 'Effect evidence must be nonempty, no longer than 256 characters, and contain no recognized credentials')
      }
      if (state === 'no-effect' && !this.persistEffectMarker) {
        throw new TaskRuntimeError('EFFECT_EVIDENCE_NOT_DURABLE', 'Automatic no-effect reconciliation requires durable task snapshot storage')
      }
      const effects = record.effectLedger!
      const previous = effects[index]!
      const previousEffectMayHaveStarted = record.effectMayHaveStarted
      const previousUpdatedAt = record.updatedAt
      const updatedAt = new Date().toISOString()
      effects[index] = { ...previous, state, evidence: normalizedEvidence, resolvedAt: updatedAt }
      const currentEffects = effects.filter(effect => effect.attempt === attempt)
      const verifiedNoEffect = !record.effectLedgerTruncated && currentEffects.length > 0 && currentEffects.every(effect => effect.state === 'no-effect')
      record.effectMayHaveStarted = !verifiedNoEffect
      record.updatedAt = updatedAt
      try { await this.persistEffectMarker?.() }
      catch (error) {
        effects[index] = previous
        record.effectMayHaveStarted = previousEffectMayHaveStarted
        record.updatedAt = previousUpdatedAt
        throw error
      }
      this.events.emit('effect_outcome', { effectId, attempt, tool: previous.tool, state, evidence: normalizedEvidence }, record.taskId, record.parentTaskId)
    }
    let runnerEffectId: string | undefined
    try {
      if (record.effectPolicy !== 'tool-gated') runnerEffectId = await markEffectStarted('unclassified_task_runner')
      runnerPromise = Promise.resolve().then(() => {
        controller.signal.throwIfAborted()
        return slot.runner({
          sessionId: this.sessionId,
          taskId: record.taskId,
          budgetGroupId: record.budgetGroupId!,
          attempt,
          signal: controller.signal,
          workspacePath: record.workspace?.path ?? this.projectRoot,
          projectRoot: this.projectRoot,
          maxTokens: record.maxTokens,
          maxCostUsd: record.maxCostUsd,
          runnerEffectId,
          sendMessage: (type, payload, recipientId) => this.sendMessage(record.taskId, type, payload, recipientId ?? 'coordinator', record.taskId),
          receiveMessages: status => this.mailbox.list(record.taskId, status),
          acknowledgeMessage: messageId => this.acknowledgeMessage(messageId),
          markEffectStarted,
          markEffectOutcome,
          trackProcess: child => this.trackProcess(slot, child, attempt),
          setPartial: value => {
            if (record.attempt !== attempt || !slot.inFlight) return
            slot.partial = structuredClone(value)
            record.partial = structuredClone(value)
            if (TERMINAL.has(record.state) && record.result) {
              record.result.partial = structuredClone(value)
            }
            record.updatedAt = new Date().toISOString()
            this.events.emit('partial_updated', { partial: record.partial }, record.taskId, record.parentTaskId)
          },
          recordArtifact: artifact => {
            if (record.attempt === attempt && slot.inFlight) this.recordArtifact(record.taskId, artifact)
          },
        })
      })
      const output = await Promise.race([
        runnerPromise,
        aborted,
      ])
      if (record.attempt !== attempt || record.state !== 'running') return
      if (record.process) {
        record.process = observeProcess(record.process)
        if (isProcessActive(record.process)) throw new TaskRuntimeError('PROCESS_STILL_ACTIVE', 'Task runner returned while its owned process or process group was still active; reconcile its effects before starting another task', false)
      }
      if (slot.settledAttempt === attempt) throw new TaskRuntimeError('DOUBLE_COMPLETION', `Task '${record.taskId}' attempt ${attempt} completed twice`)
      slot.settledAttempt = attempt
      slot.record.metrics.latencyMs = Date.now() - started
      this.retryFailures.delete(record.taskId)
      const envelope = normalizeTaskResult(slot, this.sessionId, output)
      record.metrics = { ...envelope.metrics }
      enforceTaskBudget(record, envelope)
      record.error = undefined
      record.blockReason = undefined
      this.transition(slot, 'done')
      slot.record.result = envelope
      slot.completion.resolve(envelope)
      this.events.emit('completed', { attempt, metrics: envelope.metrics }, record.taskId, record.parentTaskId)
      this.notifyDependents(record.taskId)
    } catch (cause) {
      if (record.attempt !== attempt || record.state !== 'running') return
      const error = toTaskError(cause)
      if (record.process) error.retryable = false
      if (record.effectMayHaveStarted && error.retryable) {
        error.retryable = false
        error.message = `${error.message} (automatic retry stopped after a possible external effect; inspect task evidence before resuming)`
      }
      if (error.retryable && !record.process) {
        const previous = this.retryFailures.get(record.taskId)
        const repeated = previous && previous.code === error.code && previous.message === error.message && previous.cause === error.cause && isDeepStrictEqual(previous.partial, slot.partial)
        const count = repeated ? previous.count + 1 : 1
        this.retryFailures.set(record.taskId, { code: error.code, message: error.message, cause: error.cause, partial: structuredClone(slot.partial), count })
        if (count >= RETRY_CIRCUIT_BREAKER_THRESHOLD) {
          error.retryable = false
          error.message = `${error.message} (automatic retries stopped after ${count} identical failures without new partial progress)`
        }
      }
      if (error.code === 'TIMED_OUT') {
        const envelope = this.finish(slot, 'timed_out', undefined, error)
        slot.completion.resolve(envelope)
        this.events.emit('timeout', { error }, record.taskId, record.parentTaskId)
        this.notifyDependents(record.taskId)
      } else if (error.code === 'CANCELLED') {
        const envelope = this.finish(slot, 'cancelled', undefined, error)
        slot.completion.resolve(envelope)
        this.events.emit('cancelled', { error }, record.taskId, record.parentTaskId)
        this.notifyDependents(record.taskId)
      } else if (error.code === 'BLOCKED') {
        record.blockReason = error.message
        this.transition(slot, 'blocked')
        this.events.emit('blocked', { error }, record.taskId, record.parentTaskId)
      } else if (record.attempt <= record.maxRetries && error.retryable && !record.process) {
        record.error = error
        this.transition(slot, 'failed')
        const delay = this.limits.retryBackoffMs * 2 ** (record.attempt - 1)
        this.events.emit('retry', { attempt, delay, error }, record.taskId, record.parentTaskId)
        this.transition(slot, 'queued', 'retry')
        const timer = setTimeout(() => {
          this.retryTimers.delete(record.taskId)
          if (slot.record.state !== 'queued') return
          this.enqueue(record.taskId)
        }, delay)
        this.retryTimers.set(record.taskId, timer)
      } else {
        const envelope = this.finish(slot, 'failed', undefined, error)
        slot.completion.resolve(envelope)
        this.events.emit('error', { error }, record.taskId, record.parentTaskId)
        this.notifyDependents(record.taskId)
      }
    } finally {
      clearTimeout(timeout)
      await runnerPromise?.catch(() => undefined)
      slot.inFlight = false
      this.events.emit('attempt_finished', { attempt, state: record.state, latencyMs: Date.now() - started }, record.taskId, record.parentTaskId)
      if (slot.controller === controller) slot.controller = undefined
      try { await this.queueEffectPropagation(record.taskId) } catch { /* Late receipts stay unknown if propagation cannot be persisted. */ }
      if (record.state === 'queued' && !this.retryTimers.has(record.taskId)) this.enqueue(record.taskId)
    }
  }

  private queueEffectPropagation(taskId: string): Promise<void> {
    const chainId = this.propagationRoot(taskId)
    const previous = this.effectPropagationChains.get(chainId) ?? Promise.resolve()
    this.effectPropagationPending++
    const operation = previous.then(() => this.propagateSettledEffects(taskId))
    const tail = operation.catch(() => undefined).finally(() => {
      this.effectPropagationPending--
      if (this.effectPropagationChains.get(chainId) === tail) this.effectPropagationChains.delete(chainId)
    })
    this.effectPropagationChains.set(chainId, tail)
    return operation
  }

  private propagationRoot(taskId: string): string {
    let record = this.slot(taskId).record
    const visited = new Set<string>()
    while (record.parentTaskId && !visited.has(record.parentTaskId)) {
      visited.add(record.taskId)
      const parent = this.tasks.get(record.parentTaskId)?.record
      if (!parent) break
      record = parent
    }
    return record.taskId
  }

  private subtreeTaskIds(taskId: string): string[] {
    const pending = [taskId]
    const taskIds: string[] = []
    const visited = new Set<string>()
    while (pending.length > 0) {
      const currentId = pending.pop()!
      if (visited.has(currentId)) continue
      visited.add(currentId)
      const current = this.tasks.get(currentId)
      if (!current) continue
      taskIds.push(currentId)
      for (const slot of this.tasks.values()) {
        if (slot.record.parentTaskId === currentId) pending.push(slot.record.taskId)
      }
    }
    return taskIds
  }

  private scheduleEffectPropagation(taskId: string): void {
    void this.queueEffectPropagation(taskId).catch(() => undefined)
  }

  /** Propagate only durable positive outcomes from closed linked child subtrees. */
  private async propagateSettledEffects(taskId: string): Promise<void> {
    const visited = new Set<string>()
    let currentId: string | undefined = taskId
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId)
      const current = this.tasks.get(currentId)
      if (!current) return
      await this.promoteClosedChildEffects(current)
      if (!current.record.parentTaskId || !current.record.parentEffectId || !this.isSubtreeClosed(currentId)) return
      currentId = current.record.parentTaskId
    }
  }

  private async promoteClosedChildEffects(parentSlot: TaskSlot<unknown>): Promise<void> {
    const parent = parentSlot.record
    if (!TERMINAL.has(parent.state) || parentSlot.inFlight || !this.persistEffectMarker) return
    const children = [...this.tasks.values()].filter(slot => slot.record.parentTaskId === parent.taskId)
    if (children.length === 0) return

    // Persist terminal child states before relying on them as proof of a closed subtree.
    try { await this.persistEffectMarker() } catch { return }

    for (const effect of parent.effectLedger ?? []) {
      if (effect.tool !== 'subagent' || effect.state !== 'unknown' || effect.attempt !== parent.attempt) continue
      const matchingChildren = children.filter(slot => slot.record.parentEffectId === effect.id
        && slot.record.parentEffectAttempt === effect.attempt)
      if (matchingChildren.length === 0 || matchingChildren.some(slot => !this.isSubtreeClosed(slot.record.taskId))) continue

      const aggregates = matchingChildren.map(slot => this.getObservedEffectAggregate(slot.record.taskId, effect.id))
      if (aggregates.some(aggregate => aggregate.parentEffectIdMatches !== true
        || !aggregate.allRecordedEffectsSettled)) continue
      const observedEffects = aggregates.flatMap(aggregate => aggregate.observedEffects)
        .sort((left, right) => left.taskId.localeCompare(right.taskId)
          || left.attempt - right.attempt || left.effectId.localeCompare(right.effectId))
      if (observedEffects.length === 0) continue
      const evidence = `descendant-effects-sha256:${createHash('sha256').update(JSON.stringify(observedEffects)).digest('hex')}`
      const ledger = parent.effectLedger!
      const exactEntries = ledger.filter(entry => entry.id === effect.id && entry.attempt === effect.attempt)
      if (exactEntries.length !== 1 || exactEntries[0]!.state !== 'unknown') continue

      const index = ledger.indexOf(exactEntries[0]!)
      const previousEffect = ledger[index]!
      const previousEffectMayHaveStarted = parent.effectMayHaveStarted
      const previousUpdatedAt = parent.updatedAt
      const resolvedAt = new Date().toISOString()
      ledger[index] = { ...previousEffect, state: 'effect-observed', evidence, resolvedAt }
      parent.effectMayHaveStarted = true
      parent.updatedAt = resolvedAt
      try { await this.persistEffectMarker() }
      catch {
        ledger[index] = previousEffect
        parent.effectMayHaveStarted = previousEffectMayHaveStarted
        parent.updatedAt = previousUpdatedAt
        return
      }
      this.events.emit('effect_outcome', {
        effectId: effect.id, attempt: effect.attempt, tool: effect.tool,
        state: 'effect-observed', evidence,
      }, parent.taskId, parent.parentTaskId)
    }
  }

  private isSubtreeClosed(taskId: string): boolean {
    const pending = [taskId]
    const visited = new Set<string>()
    while (pending.length > 0) {
      const currentId = pending.pop()!
      if (visited.has(currentId)) continue
      visited.add(currentId)
      const current = this.tasks.get(currentId)
      if (!current || current.inFlight || !TERMINAL.has(current.record.state)) return false
      for (const slot of this.tasks.values()) {
        if (slot.record.parentTaskId === currentId) pending.push(slot.record.taskId)
      }
    }
    return true
  }

  private trackProcess(slot: TaskSlot<unknown>, child: ChildProcess, attempt: number): void {
    if (slot.record.attempt !== attempt || !slot.inFlight) return
    if (slot.record.process && isProcessActive(observeProcess(slot.record.process))) throw new TaskRuntimeError('PROCESS_ALREADY_REGISTERED', 'This attempt already owns a running process or process group')
    if (slot.processHeartbeat) clearInterval(slot.processHeartbeat)
    slot.processHeartbeat = undefined
    const observation = captureProcess(child)
    slot.record.process = observation
    slot.record.updatedAt = new Date().toISOString()
    const recordExit = (exitCode: number | null, signal: NodeJS.Signals | null, reason?: string) => {
      const current = slot.record.process
      if (slot.record.attempt !== attempt || !current || (observation.identity
        ? current.identity?.pid !== observation.identity.pid
          || current.identity.bootId !== observation.identity.bootId
          || current.identity.pidNamespace !== observation.identity.pidNamespace
          || current.identity.startTimeTicks !== observation.identity.startTimeTicks
        : current !== observation)) return
      const next = observeProcess({ ...current, status: 'exited', provenance: 'child-event', observedAt: new Date().toISOString(), reason, exitCode, signal })
      slot.record.process = next
      slot.record.updatedAt = new Date().toISOString()
      this.events.emit('process_observed', { process: next }, slot.record.taskId, slot.record.parentTaskId)
      if (isProcessActive(next) && next.identity) this.startProcessHeartbeat(slot, attempt, next.identity)
      else if (slot.processHeartbeat) {
        clearInterval(slot.processHeartbeat)
        slot.processHeartbeat = undefined
      }
    }
    child.once('exit', (exitCode, signal) => recordExit(exitCode, signal))
    child.once('error', () => { if (child.pid === undefined) recordExit(null, null, 'spawn-failed') })
    this.events.emit('process_observed', { process: observation }, slot.record.taskId, slot.record.parentTaskId)
    const identity = observation.identity
    if (observation.status === 'alive' && observation.provenance === 'kernel' && identity) this.startProcessHeartbeat(slot, attempt, identity)
  }

  private startProcessHeartbeat(slot: TaskSlot<unknown>, attempt: number, identity: ProcessIdentity): void {
    if (slot.processHeartbeat) clearInterval(slot.processHeartbeat)
    const heartbeat = setInterval(() => {
      const current = slot.record.process
      if (slot.record.attempt !== attempt || !current || current.identity?.pid !== identity.pid
        || current.identity.bootId !== identity.bootId || current.identity.pidNamespace !== identity.pidNamespace
        || current.identity.startTimeTicks !== identity.startTimeTicks) {
        clearInterval(heartbeat)
        if (slot.processHeartbeat === heartbeat) slot.processHeartbeat = undefined
        return
      }
      const next = observeProcess(current)
      slot.record.process = next
      slot.record.updatedAt = next.observedAt
      this.events.emit('process_observed', { process: next }, slot.record.taskId, slot.record.parentTaskId)
        if (!isProcessActive(next)) {
        clearInterval(heartbeat)
        if (slot.processHeartbeat === heartbeat) slot.processHeartbeat = undefined
      }
    }, PROCESS_HEARTBEAT_MS)
    heartbeat.unref?.()
    slot.processHeartbeat = heartbeat
  }

  /** Transition to a failure state and store the matching result envelope. */
  private finish(slot: TaskSlot<unknown>, state: 'failed' | 'cancelled' | 'timed_out', value: unknown, error: TaskErrorV1): TaskResultEnvelopeV1 {
    this.retryFailures.delete(slot.record.taskId)
    this.transition(slot, state)
    return createFailureEnvelope(slot, state, this.sessionId, value, error)
  }

  /** Apply the dependency policy: a failed dependency cancels, fails or blocks the task; pending dependencies keep it blocked; once all are done a task blocked only by waiting is re-queued. */
  private evaluateDependencies(slot: TaskSlot<unknown>): void {
    if (TERMINAL.has(slot.record.state)) return
    const dependencies = slot.record.dependencies.map(id => this.slot(id).record)
    const failed = dependencies.find(record => ['failed', 'cancelled', 'timed_out'].includes(record.state))
    if (failed) {
      const reason = `Dependency '${failed.taskId}' ended as ${failed.state}`
      if (slot.record.dependencyFailurePolicy === 'cancel') {
        this.cancel(slot.record.taskId, reason)
      } else if (slot.record.dependencyFailurePolicy === 'fail') {
        if (slot.record.state === 'queued') this.transition(slot, 'blocked')
        const envelope = this.finish(slot, 'failed', undefined, { code: 'DEPENDENCY_FAILED', message: reason, retryable: false })
        slot.completion.resolve(envelope)
        if (!slot.inFlight) this.scheduleEffectPropagation(slot.record.taskId)
      } else {
        slot.record.blockReason = reason
        if (slot.record.state === 'queued') this.transition(slot, 'blocked')
      }
      return
    }
    if (!dependencies.every(record => record.state === 'done')) {
      slot.record.blockReason = `Waiting for dependencies: ${dependencies.filter(record => record.state !== 'done').map(record => record.taskId).join(', ')}`
      if (slot.record.state === 'queued') this.transition(slot, 'blocked')
      return
    }
    if (slot.record.state === 'blocked' && slot.record.blockReason?.startsWith('Waiting for dependencies:')) {
      slot.record.blockReason = undefined
      this.transition(slot, 'queued', 'dependency_ready')
      this.enqueue(slot.record.taskId)
    }
  }

  private notifyDependents(taskId: string): void {
    for (const dependent of this.slot(taskId).record.dependents) this.evaluateDependencies(this.slot(dependent))
  }

  private dependenciesDone(record: TaskRecordV1): boolean {
    return record.dependencies.every(id => this.slot(id).record.state === 'done')
  }

  /** Whether `target` is reachable from `from` along dependency edges; used for cycle detection. */
  private reaches(from: string, target: string, seen = new Set<string>()): boolean {
    if (from === target) return true
    if (seen.has(from)) return false
    seen.add(from)
    return this.slot(from).record.dependencies.some(id => this.reaches(id, target, seen))
  }

  private childrenOf(parentTaskId: string): TaskRecordV1[] {
    return this.listTasks().filter(record => record.parentTaskId === parentTaskId)
  }

  /** Apply a state change after checking the state machine. Re-queueing from a terminal state requires a resume or retry cause; updates timestamps and emits state_changed. */
  private transition(slot: TaskSlot<unknown>, to: TaskState, cause?: 'resume' | 'retry' | 'dependency_ready'): void {
    const from = slot.record.state
    if (from === to) return
    if (!canTransition(from, to)) throw new InvalidTaskTransitionError(slot.record.taskId, from, to)
    if (to === 'queued' && ['failed', 'cancelled', 'timed_out'].includes(from) && cause !== 'resume' && cause !== 'retry') {
      throw new InvalidTaskTransitionError(slot.record.taskId, from, to)
    }
    slot.record.state = to
    slot.record.updatedAt = new Date().toISOString()
    if (to === 'queued') slot.record.queuedAt = slot.record.updatedAt
    if (to === 'queued') slot.record.completedAt = undefined
    if (TERMINAL.has(to)) {
      slot.record.completedAt = slot.record.updatedAt
      slot.record.deadline = undefined
    }
    this.events.emit('state_changed', { from, to, cause }, slot.record.taskId, slot.record.parentTaskId)
  }

  private slot(taskId: string): TaskSlot<unknown> {
    const slot = this.tasks.get(taskId)
    if (!slot) throw new TaskRuntimeError('TASK_NOT_FOUND', `Task '${taskId}' was not found`)
    return slot
  }

  private clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) throw new TaskRuntimeError('INVALID_LIMIT', `Invalid numeric limit: ${value}`)
    return Math.max(min, Math.min(max, Math.trunc(value)))
  }
}
