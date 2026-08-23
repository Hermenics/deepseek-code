import { randomUUID } from 'node:crypto'
import { TaskEventSink } from './events.js'
import { TaskMailbox } from './mailbox.js'
import { canTransition, InvalidTaskTransitionError, normalizeTaskLimits, TaskRuntimeError, TERMINAL_TASK_STATES as TERMINAL } from './lifecycle.js'
import { createFailureEnvelope, enforceTaskBudget, normalizeTaskResult, toTaskError } from './result.js'
import { deferred, type TaskSlot } from './runtimeSlot.js'
import { validateRestoredTaskRecord } from './schema.js'
import {
  DEFAULT_TASK_LIMITS, type SpawnTaskInput, type TaskErrorV1, type TaskHandle, type TaskLimits,
  type TaskMessageType, type TaskMessageV1, type TaskRecordV1, type TaskResultEnvelopeV1,
  type TaskRunner, type TaskRunnerResolver, type TaskState, type TaskWorkspaceV1,
} from './types.js'

export interface TaskRegistryOptions {
  sessionId?: string
  projectRoot: string
  limits?: Partial<TaskLimits>
  events?: TaskEventSink
  mailbox?: TaskMailbox
}
export class TaskRegistry {
  readonly sessionId: string
  projectRoot: string
  readonly events: TaskEventSink
  readonly mailbox: TaskMailbox
  private limits: TaskLimits
  private readonly tasks = new Map<string, TaskSlot<unknown>>()
  private readonly queue: string[] = []
  private queued = new Set<string>()
  private active = 0
  private draining = false
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  constructor(options: TaskRegistryOptions) {
    this.sessionId = options.sessionId ?? randomUUID()
    this.projectRoot = options.projectRoot
    this.limits = normalizeTaskLimits({ ...DEFAULT_TASK_LIMITS, ...options.limits })
    this.events = options.events ?? new TaskEventSink(this.sessionId)
    this.mailbox = options.mailbox ?? new TaskMailbox()
  }
  updateLimits(values: Partial<TaskLimits>): void { this.limits = normalizeTaskLimits({ ...this.limits, ...values }); this.scheduleDrain() }
  getLimits(): TaskLimits { return { ...this.limits } }
  async awaitIdle(): Promise<void> {
    while (this.active > 0 || [...this.tasks.values()].some(slot => slot.inFlight)) await new Promise(resolve => setTimeout(resolve, 0))
  }
  spawn<T>(input: SpawnTaskInput, runner: TaskRunner<T>): TaskHandle<T> {
    if (this.tasks.size >= this.limits.maxTasks) throw new TaskRuntimeError('TASK_LIMIT', `Task limit ${this.limits.maxTasks} reached`)
    const taskId = input.taskId ?? randomUUID()
    if (this.tasks.has(taskId)) throw new TaskRuntimeError('DUPLICATE_TASK', `Task '${taskId}' already exists`)
    const parent = input.parentTaskId ? this.slot(input.parentTaskId).record : undefined
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
  getStatus<T = unknown>(taskId: string): TaskRecordV1<T> { return structuredClone(this.slot(taskId).record) as TaskRecordV1<T> }
  listTasks(filter?: { state?: TaskState; parentTaskId?: string }): TaskRecordV1[] {
    return [...this.tasks.values()]
      .map(slot => slot.record)
      .filter(record => !filter?.state || record.state === filter.state)
      .filter(record => filter?.parentTaskId === undefined || record.parentTaskId === filter.parentTaskId)
      .map(record => structuredClone(record))
  }
  listReady(): TaskRecordV1[] { return this.listTasks({ state: 'queued' }).filter(record => this.dependenciesDone(record)) }
  restoreTasks(records: TaskRecordV1[], resolver?: TaskRunnerResolver): void {
    if (this.tasks.size > 0) throw new TaskRuntimeError('RESTORE_NOT_EMPTY', 'Tasks can only be restored into an empty registry')
    if (records.length > this.limits.maxTasks) throw new TaskRuntimeError('TASK_LIMIT', `Snapshot exceeds task limit ${this.limits.maxTasks}`)
    const unavailable: TaskRunner = async () => { throw new TaskRuntimeError('RUNNER_UNAVAILABLE', 'Task runner must be reattached after restart') }
    for (const source of records) {
      const validation = validateRestoredTaskRecord(source, this.sessionId)
      if (!validation.valid) throw new TaskRuntimeError('INVALID_SNAPSHOT', `Invalid restored task: ${validation.errors.join('; ')}`)
      if (source.sessionId !== this.sessionId || this.tasks.has(source.taskId)) throw new TaskRuntimeError('INVALID_SNAPSHOT', `Invalid restored task '${source.taskId}'`)
      const record = structuredClone(source)
      record.dependents = []
      const runner = resolver?.(structuredClone(record))
      if (record.state === 'running') {
        const error: TaskErrorV1 = { code: 'INTERRUPTED', message: 'Process stopped while task was running', retryable: true }
        record.state = 'failed'; record.error = error; record.completedAt = new Date().toISOString(); record.deadline = undefined
        record.result = {
          schemaVersion: 1, taskId: record.taskId, sessionId: this.sessionId, status: 'failed',
          partial: record.result?.partial, artifacts: record.result?.artifacts ?? [], metrics: record.metrics,
          error, completedAt: record.completedAt,
        }
      } else if (record.state === 'queued' && !runner) {
        record.state = 'blocked'; record.blockReason = 'Runner unavailable after restart'
      }
      const slot: TaskSlot = { record, runner: runner ?? unavailable, completion: deferred() }
      this.tasks.set(record.taskId, slot)
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
    }
  }
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
  awaitResult<T = unknown>(taskId: string): Promise<TaskResultEnvelopeV1<T>> {
    const slot = this.slot(taskId) as TaskSlot<T>
    if (slot.record.result && TERMINAL.has(slot.record.state)) return Promise.resolve(structuredClone(slot.record.result))
    return slot.completion.promise.then(result => structuredClone(result))
  }
  getResult<T = unknown>(taskId: string): TaskResultEnvelopeV1<T> | undefined {
    const result = (this.slot(taskId) as TaskSlot<T>).record.result
    return result ? structuredClone(result) : undefined
  }
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
    return true
  }
  cancelAll(reason = 'Session cancelled'): void {
    for (const record of this.listTasks()) if (!TERMINAL.has(record.state)) this.cancel(record.taskId, reason)
  }
  resume(taskId: string): boolean {
    const slot = this.slot(taskId)
    if (!['blocked', 'failed', 'cancelled', 'timed_out'].includes(slot.record.state)) return false
    const wasBlocked = slot.record.state === 'blocked'
    if (!wasBlocked && slot.record.attempt >= slot.record.maxRetries + 1) return false
    if (!wasBlocked) slot.completion = deferred()
    slot.record.result = undefined
    slot.record.error = undefined
    slot.record.blockReason = undefined
    this.transition(slot, 'queued', 'resume')
    this.evaluateDependencies(slot)
    if (slot.record.state === 'queued') this.enqueue(taskId)
    return true
  }
  block(taskId: string, reason: string): boolean {
    const slot = this.slot(taskId)
    if (!['queued', 'running'].includes(slot.record.state)) return false
    slot.controller?.abort(new TaskRuntimeError('BLOCKED', reason, true))
    slot.record.blockReason = reason
    this.transition(slot, 'blocked')
    this.events.emit('blocked', { reason }, taskId, slot.record.parentTaskId)
    return true
  }
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
  setWorkspace(taskId: string, workspace: TaskWorkspaceV1): void {
    const slot = this.slot(taskId)
    slot.record.workspace = structuredClone(workspace)
    slot.record.updatedAt = new Date().toISOString()
    this.events.emit('workspace_updated', { workspace: slot.record.workspace }, taskId, slot.record.parentTaskId)
  }
  clearWorkspace(taskId: string): void {
    const slot = this.slot(taskId)
    slot.record.workspace = undefined
    slot.record.updatedAt = new Date().toISOString()
    this.events.emit('workspace_updated', { workspace: null }, taskId, slot.record.parentTaskId)
  }
  updateMetadata(taskId: string, metadata: Record<string, unknown>): void {
    const slot = this.slot(taskId)
    slot.record.metadata = { ...slot.record.metadata, ...structuredClone(metadata) }
    slot.record.updatedAt = new Date().toISOString()
    this.events.emit('metadata_updated', { metadata }, taskId, slot.record.parentTaskId)
  }

  updateMetrics(taskId: string, metrics: Partial<TaskRecordV1['metrics']>): void {
    const slot = this.slot(taskId)
    slot.record.metrics = { ...slot.record.metrics, ...metrics }
    slot.record.updatedAt = new Date().toISOString()
    this.events.emit('metrics_updated', { metrics: slot.record.metrics }, taskId, slot.record.parentTaskId)
  }

  acknowledgeMessage(messageId: string): boolean {
    const message = this.mailbox.list().find(candidate => candidate.messageId === messageId)
    const acknowledged = this.mailbox.acknowledge(messageId)
    if (acknowledged && message && message.status !== 'processed') this.events.emit('message', { messageId, status: 'processed' }, message.taskId, undefined, message.correlationId)
    return acknowledged
  }

  transitionTask(taskId: string, state: TaskState): void {
    const slot = this.slot(taskId)
    if (TERMINAL.has(state)) throw new InvalidTaskTransitionError(taskId, slot.record.state, state)
    this.transition(slot, state)
  }

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

  private enqueue(taskId: string): void {
    if (this.queued.has(taskId)) return
    if (this.slot(taskId).inFlight) return
    this.queued.add(taskId)
    this.queue.push(taskId)
    this.scheduleDrain()
  }

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

  private async run(slot: TaskSlot<unknown>): Promise<void> {
    const record = slot.record
    slot.inFlight = true
    slot.partial = undefined
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

    let runnerPromise: Promise<unknown> | undefined
    try {
      const aborted = new Promise<never>((_, reject) => {
        if (controller.signal.aborted) reject(controller.signal.reason)
        else controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
      })
      runnerPromise = Promise.resolve().then(() => slot.runner({
        sessionId: this.sessionId,
        taskId: record.taskId,
        attempt,
        signal: controller.signal,
        workspacePath: record.workspace?.path ?? this.projectRoot,
        projectRoot: this.projectRoot,
        maxTokens: record.maxTokens,
        maxCostUsd: record.maxCostUsd,
        sendMessage: (type, payload, recipientId) => this.sendMessage(record.taskId, type, payload, recipientId ?? 'coordinator', record.taskId),
        receiveMessages: status => this.mailbox.list(record.taskId, status),
        acknowledgeMessage: messageId => this.acknowledgeMessage(messageId),
        setPartial: value => { slot.partial = structuredClone(value) },
      }))
      const output = await Promise.race([
        runnerPromise,
        aborted,
      ])
      if (record.attempt !== attempt || record.state !== 'running') return
      if (slot.settledAttempt === attempt) throw new TaskRuntimeError('DOUBLE_COMPLETION', `Task '${record.taskId}' attempt ${attempt} completed twice`)
      slot.settledAttempt = attempt
      slot.record.metrics.latencyMs = Date.now() - started
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
      } else if (record.attempt <= record.maxRetries && error.retryable) {
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
      if (record.state === 'queued' && !this.retryTimers.has(record.taskId)) this.enqueue(record.taskId)
    }
  }

  private finish(slot: TaskSlot<unknown>, state: 'failed' | 'cancelled' | 'timed_out', value: unknown, error: TaskErrorV1): TaskResultEnvelopeV1 {
    this.transition(slot, state)
    return createFailureEnvelope(slot, state, this.sessionId, value, error)
  }

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

  private reaches(from: string, target: string, seen = new Set<string>()): boolean {
    if (from === target) return true
    if (seen.has(from)) return false
    seen.add(from)
    return this.slot(from).record.dependencies.some(id => this.reaches(id, target, seen))
  }

  private childrenOf(parentTaskId: string): TaskRecordV1[] {
    return this.listTasks().filter(record => record.parentTaskId === parentTaskId)
  }

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
