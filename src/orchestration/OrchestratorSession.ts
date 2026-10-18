import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ProviderConfig } from '../types/provider.js'
import type { DeepSeekSettings } from '../settings/types.js'
import { captureWorkspaceVersion, diffWorkspaceFileDigests, restoreWorkspaceFileDigests } from '../agent/workspaceVersion.js'
import { TaskEventSink, type TaskEventListener } from './events.js'
import { TaskRegistry } from './TaskRegistry.js'
import { TaskSnapshotStore } from './snapshot.js'
import { MemoryStore } from '../agent/memory.js'
import { TaskWorkspaceManager, type IntegrationResult, type WorkspaceLease } from './workspace.js'
import type {
  PermissionProfile,
  SpawnTaskInput,
  TaskEventType,
  TaskHandle,
  TaskLimits,
  TaskRunner,
  TaskRunnerResolver,
  ShellWorkspaceObservationV1,
  ToolExecutionContext,
} from './types.js'
import type { AskUserHandler } from '../tools/AskUserQuestions/types.js'
import { closeLspSession } from '../lsp.js'

const MAX_FORK_CONTEXT_BYTES = 16_000

export interface OrchestratorCallbacks {
  onStart?(id: string, task: string, agentName?: string): void
  onToolUse?(id: string, tool: string, info?: string): void
  onTokens?(id: string, tokens: number): void
  onMessage?(id: string, role: string, content: string): void
  onDone?(id: string, result: string, tokens?: number, costUsd?: number, structured?: unknown): void
  onError?(id: string, error: string): void
  onNote?(agentName: string, text: string): void
}

export interface OrchestratorSessionOptions {
  protectedPaths?: readonly string[]
  sessionId?: string
  projectRoot?: string
  providerConfig?: ProviderConfig
  model?: string
  settings?: DeepSeekSettings
  limits?: Partial<TaskLimits>
  logFile?: string | null
  snapshotFile?: string | null
  toolExecution?: DurableToolExecution
}

/** Optional outer journal for a persistent actor; failures stop execution instead of becoming tool output. */
export interface DurableToolExecution {
  before(tool: string, args: Record<string, unknown>, taskId?: string): DurableToolExecutionDecision | Promise<DurableToolExecutionDecision>
  after(actionId: string, result: string): void | Promise<void>
  requestPermission?(tool: string, args: Record<string, unknown>, taskId?: string): Promise<'allow' | 'deny'>
  /** User input at model boundaries, including native delegated/workflow executors. */
  beforeModel?(taskId?: string): string[] | Promise<string[]>
  /** Current reference data for this request only; never added to durable history. */
  modelReference?(taskId?: string): string | undefined | Promise<string | undefined>
}
export type DurableToolExecutionDecision = string | null | { kind: 'simulate'; result: string }
export class DurableExecutionError extends Error {}

/** Default snapshot path for a session: ~/.deepseek/task-snapshots/<hashed session ID>.json. */
export function taskSnapshotFile(sessionId: string): string {
  const key = createHash('sha256').update(sessionId).digest('hex').slice(0, 32)
  return join(homedir(), '.deepseek', 'task-snapshots', `${key}.json`)
}

interface PreviousResult {
  taskId: string
  task: string
  summary: string
  confidence: number
  filesRead: string[]
  filesChanged: string[]
  issuesFound: string[]
}

function inside(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

/** Per-session facade that wires the task registry, event log, snapshot persistence, workspaces and memory together, and translates task events into the UI callbacks. */
export class OrchestratorSession {
  readonly sessionId: string
  projectRoot: string
  readonly events: TaskEventSink
  readonly registry: TaskRegistry
  readonly workspaces: TaskWorkspaceManager
  readonly memory: MemoryStore
  private providerConfig: ProviderConfig
  private model?: string
  private settings: DeepSeekSettings
  private callbacks: OrchestratorCallbacks = {}
  private previousResults: PreviousResult[] = []
  private readonly snapshotStore?: TaskSnapshotStore
  private restored = false
  private genericAgentCounter = 0
  private readonly toolExecution?: DurableToolExecution
  private readonly protectedPaths: readonly string[]

  constructor(options: OrchestratorSessionOptions = {}) {
    this.toolExecution = options.toolExecution
    this.protectedPaths = [...(options.protectedPaths ?? [])]
    this.sessionId = options.sessionId ?? randomUUID()
    this.projectRoot = resolve(options.projectRoot ?? process.cwd())
    this.providerConfig = options.providerConfig ?? { provider: 'deepseek' }
    this.model = options.model
    this.settings = structuredClone(options.settings ?? {})
    const storageKey = createHash('sha256').update(this.sessionId).digest('hex').slice(0, 32)
    const logFile = options.logFile === null
      ? undefined
      : options.logFile ?? join(homedir(), '.deepseek', 'logs', `session-${storageKey}.jsonl`)
    this.events = new TaskEventSink(this.sessionId, logFile)
    this.snapshotStore = options.snapshotFile ? new TaskSnapshotStore(options.snapshotFile) : undefined
    this.registry = new TaskRegistry({
      sessionId: this.sessionId, projectRoot: this.projectRoot, limits: options.limits, events: this.events,
      persistEffectMarker: this.snapshotStore ? async () => {
        this.snapshotStore!.save(this.sessionId, this.projectRoot, this.registry.listTasks(), this.registry.mailbox.list())
        await this.snapshotStore!.flush()
      } : undefined,
      persistReconciliation: this.snapshotStore ? async () => {
        this.snapshotStore!.save(this.sessionId, this.projectRoot, this.registry.listTasks(), this.registry.mailbox.list())
        await this.snapshotStore!.flush()
      } : undefined,
    })
    this.workspaces = new TaskWorkspaceManager(this.projectRoot, this.sessionId, this.events)
    this.memory = new MemoryStore(this.projectRoot)
    this.events.subscribe(event => {
      this.routeCompatibilityEvent(event.type, event.taskId, event.payload)
      this.queueSnapshot()
    })
  }

  /** Called after the executor's permission gates, around the actual effect. */
  async executeJournaled(tool: string, args: Record<string, unknown>, execute: () => Promise<string>, taskId?: string): Promise<string> {
    if (!this.toolExecution) return execute()
    let decision: DurableToolExecutionDecision
    try { decision = await this.toolExecution.before(tool, args, taskId) }
    catch (error) { throw new DurableExecutionError(`Durable action guard failed: ${error instanceof Error ? error.message : String(error)}`) }
    if (decision === null) return 'Action superseded by new task input or saved memory. Read the current context and reconsider this action with current approvals.'
    if (typeof decision === 'object') return decision.result
    const id = decision
    const result = await execute()
    try { await this.toolExecution.after(id, result) }
    catch (error) { throw new DurableExecutionError(`Durable action checkpoint failed: ${error instanceof Error ? error.message : String(error)}`) }
    return result
  }
  async beforeModelRequest(taskId?: string): Promise<string[]> {
    return await this.toolExecution?.beforeModel?.(taskId) ?? []
  }
  async modelReference(taskId?: string): Promise<string | undefined> {
    return this.toolExecution?.modelReference?.(taskId)
  }
  requestToolPermission(tool: string, args: Record<string, unknown>, taskId?: string): Promise<'allow' | 'deny'> | undefined {
    return this.toolExecution?.requestPermission?.(tool, args, taskId)
  }

  /** Rebuild a session from a snapshot file, reattaching eligible background shells, marking other interrupted tasks failed, and re-deriving the generic agent counter. */
  static async restore(options: OrchestratorSessionOptions & { snapshotFile: string; projectRoot: string; runnerResolver?: TaskRunnerResolver }): Promise<OrchestratorSession> {
    const snapshot = await TaskSnapshotStore.read(options.snapshotFile)
    if (options.sessionId && options.sessionId !== snapshot.sessionId) throw new Error('Snapshot sessionId does not match requested session')
    if (resolve(options.projectRoot) !== resolve(snapshot.projectRoot)) throw new Error('Snapshot projectRoot does not match requested project')
    const session = new OrchestratorSession({ ...options, sessionId: snapshot.sessionId, projectRoot: snapshot.projectRoot })
    session.registry.restoreTasks(snapshot.tasks, options.runnerResolver)
    session.registry.mailbox.restore(snapshot.messages)
    session.workspaces.restore(snapshot.tasks)
    await session.reconcileInterruptedShellWorkspaceObservations()
    session.syncGenericCounterFromTasks()
    session.restored = true
    session.queueSnapshot()
    return session
  }

  /** Rehydrate this session from its configured snapshot file; returns false when no snapshot exists yet. */
  async restorePersisted(runnerResolver?: TaskRunnerResolver): Promise<boolean> {
    if (this.restored || !this.snapshotStore) return false
    let snapshot
    try { snapshot = await TaskSnapshotStore.read(this.snapshotStore.file) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
    if (snapshot.sessionId !== this.sessionId) throw new Error('Persisted task session identity does not match')
    if (resolve(snapshot.projectRoot) !== resolve(this.projectRoot)) throw new Error('Persisted task project root does not match')
    this.registry.restoreTasks(snapshot.tasks, runnerResolver)
    this.registry.mailbox.restore(snapshot.messages)
    this.workspaces.restore(snapshot.tasks)
    await this.reconcileInterruptedShellWorkspaceObservations()
    this.syncGenericCounterFromTasks()
    this.restored = true
    this.queueSnapshot()
    return true
  }

  /** Update provider, model, settings and task limits for later tasks; omitted fields keep their current values. */
  configure(values: { providerConfig?: ProviderConfig; model?: string; settings?: DeepSeekSettings; limits?: Partial<TaskLimits> }): void {
    if (values.providerConfig) this.providerConfig = values.providerConfig
    if (values.model) this.model = values.model
    if (values.settings) {
      if (JSON.stringify(values.settings.lsp) !== JSON.stringify(this.settings.lsp)) closeLspSession(this)
      this.settings = structuredClone(values.settings)
    }
    if (values.limits) this.registry.updateLimits(values.limits)
  }

  /** Move the session to another project root. Refused while tasks are active or non-shared workspaces are anchored elsewhere; reconfigures memory, clears fork context and emits session_rebased. */
  async changeProjectRoot(path: string): Promise<void> {
    const target = resolve(path)
    const active = this.registry.listTasks().filter(task => !['done', 'failed', 'cancelled', 'timed_out'].includes(task.state))
    if (active.length > 0) throw new Error(`Cannot change project root while ${active.length} task(s) are active`)
    const anchored = this.registry.listTasks().filter(task =>
      task.workspace?.isolation !== 'readonly-shared' && task.workspace && resolve(task.workspace.projectRoot) !== target,
    )
    if (anchored.length > 0) throw new Error(`Cannot change project root while ${anchored.length} task workspace(s) remain anchored to the current project`)
    const previous = this.projectRoot
    closeLspSession(this)
    this.projectRoot = target
    this.registry.projectRoot = target
    this.workspaces.projectRoot = target
    await this.memory.configure(this.settings.memory ?? {}, target)
    this.previousResults = []
    this.events.emit('session_rebased', { previous, projectRoot: target })
  }

  setCallbacks(callbacks: OrchestratorCallbacks | null): void {
    this.callbacks = callbacks ?? {}
  }

  /** Allocate the next sequential generic subagent name (Agent1, Agent2, ...) for this session. */
  nextGenericAgentName(): string {
    this.genericAgentCounter += 1
    return `Agent${this.genericAgentCounter}`
  }

  /**
   * Re-derive the generic counter from restored task metadata so a rehydrated
   * session continues the AgentN sequence instead of restarting at Agent1.
   */
  private syncGenericCounterFromTasks(): void {
    for (const record of this.registry.listTasks()) {
      const name = typeof record.metadata.agentName === 'string' ? record.metadata.agentName : undefined
      const match = name?.match(/^Agent(\d+)$/)
      if (match) this.genericAgentCounter = Math.max(this.genericAgentCounter, Number(match[1]))
    }
  }

  subscribe(listener: TaskEventListener): () => void {
    return this.events.subscribe(listener)
  }

  spawn<T>(input: SpawnTaskInput, runner: TaskRunner<T>): TaskHandle<T> {
    return this.registry.spawn(input, runner)
  }

  /** Acquire the task's workspace and record it on the task. */
  async acquireWorkspace(taskId: string, profile: PermissionProfile, signal?: AbortSignal): Promise<WorkspaceLease> {
    const lease = await this.workspaces.acquire(taskId, profile, signal)
    this.registry.setWorkspace(taskId, lease.workspace)
    return lease
  }

  /** Integrate the task's workspace into the project and record the updated workspace and integration result on the task. */
  async integrateTask(taskId: string): Promise<IntegrationResult> {
    const result = JSON.parse(await this.executeJournaled('workspace_integrate', { taskId },
      async () => JSON.stringify(await this.workspaces.integrate(taskId)), taskId)) as IntegrationResult
    const workspace = this.workspaces.get(taskId)
    if (workspace) this.registry.setWorkspace(taskId, workspace)
    this.registry.updateMetadata(taskId, { integration: result })
    return result
  }

  /** Remove the task's worktree when safe and clear it from the task record; returns whether cleanup happened. */
  async cleanupTaskWorkspace(taskId: string): Promise<boolean> {
    const cleaned = await this.workspaces.cleanup(taskId)
    if (cleaned) this.registry.clearWorkspace(taskId)
    return cleaned
  }

  private async reconcileInterruptedShellWorkspaceObservations(): Promise<void> {
    const root = await realpath(this.projectRoot).catch(() => undefined)
    for (const record of this.registry.listTasks({ state: 'failed' })) {
      if (record.error?.code !== 'INTERRUPTED' || !record.partial || typeof record.partial !== 'object') continue
      const summary = record.partial as Record<string, unknown>
      const observation = summary.workspaceObservation as ShellWorkspaceObservationV1 | undefined
      if (!observation || observation.schema !== 'shell_workspace_observation_v1' || observation.status !== 'pending') continue
      let reconciled: ShellWorkspaceObservationV1 = { ...observation, status: 'unknown', observedAt: new Date().toISOString() }
      const baselineFileDigests = restoreWorkspaceFileDigests(summary.workspaceBaselineFileDigests)
      try {
        if (!root || typeof observation.cwdRelative !== 'string' || isAbsolute(observation.cwdRelative)
          || !observation.baselineDigest || !/^[a-f0-9]{64}$/.test(observation.baselineDigest)) throw new Error('Invalid workspace baseline')
        const requested = resolve(root, observation.cwdRelative)
        if (!inside(root, requested)) throw new Error('Workspace path escapes project root')
        const cwd = await realpath(requested)
        if (!inside(root, cwd) || relative(root, cwd) !== observation.cwdRelative) throw new Error('Workspace path changed')
        const version = await captureWorkspaceVersion(cwd, undefined, [], { includeFileDigests: baselineFileDigests !== undefined })
        const observedDigest = version.digest
        const changes = baselineFileDigests && version.fileDigests
          ? diffWorkspaceFileDigests(baselineFileDigests, version.fileDigests) : undefined
        reconciled = {
          ...observation,
          status: observedDigest === observation.baselineDigest ? 'no-change-observed' : 'changed',
          observedDigest,
          observedAt: new Date().toISOString(),
          fileChangesStatus: changes ? 'complete' : 'unknown',
          ...(changes ? {
            fileChangesRootRelative: relative(root, version.root) || '.',
            fileChanges: changes.changes,
            omittedFileChanges: changes.omitted,
          } : {}),
        }
      } catch { /* A missing, moved or unobservable workspace remains explicitly unknown. */ }
      const reconciledSummary = { ...summary }
      delete reconciledSummary.workspaceBaselineFileDigests
      this.registry.updateInterruptedPartial(record.taskId, { ...reconciledSummary, workspaceObservation: reconciled })
    }
  }

  /** Build the ToolExecutionContext for a tool call. Defaults the workspace to the project root and the profile to coordinator-integrator; emitted events are tagged with the task ID. */
  toolContext(input: { taskId?: string; budgetGroupId?: string; workspacePath?: string; workspaceIsolation?: ToolExecutionContext['workspaceIsolation']; signal?: AbortSignal; trackProcess?: ToolExecutionContext['trackProcess']; markEffectStarted?: ToolExecutionContext['markEffectStarted']; markEffectOutcome?: ToolExecutionContext['markEffectOutcome']; permissionProfile?: PermissionProfile; allowedTools?: string[] | '*'; maxTokens?: number; maxCostUsd?: number; dangerousOperationApproved?: boolean; approvedExternalPaths?: string[]; workflowManager?: ToolExecutionContext['workflowManager']; interactionMode?: ToolExecutionContext['interactionMode']; askUser?: AskUserHandler } = {}): ToolExecutionContext {
    return {
      sessionId: this.sessionId,
      taskId: input.taskId,
      budgetGroupId: input.budgetGroupId,
      workspacePath: input.workspacePath ?? this.projectRoot,
      projectRoot: this.projectRoot,
      workspaceIsolation: input.workspaceIsolation,
      signal: input.signal,
      trackProcess: input.trackProcess,
      markEffectStarted: input.markEffectStarted,
      markEffectOutcome: input.markEffectOutcome,
      permissionProfile: input.permissionProfile ?? 'coordinator-integrator',
      allowedTools: input.allowedTools,
      model: this.model,
      maxTokens: input.maxTokens,
      maxCostUsd: input.maxCostUsd,
      dangerousOperationApproved: input.dangerousOperationApproved,
      approvedExternalPaths: input.approvedExternalPaths,
      protectedPaths: this.protectedPaths,
      workflowManager: input.workflowManager,
      interactionMode: input.interactionMode,
      askUser: input.askUser,
      session: this,
      emit: (type, payload) => this.events.emit(type, payload, input.taskId),
    }
  }

  /** Return cloned copies of the current provider config, model and settings. */
  runtimeSnapshot(): { providerConfig: ProviderConfig; model?: string; settings: DeepSeekSettings } {
    return {
      providerConfig: structuredClone(this.providerConfig),
      model: this.model,
      settings: structuredClone(this.settings),
    }
  }

  /** Clear the previous subagent results used as fork context. */
  resetTurnMemory(): void {
    this.previousResults = []
  }

  /** Record a bounded, source-referencing subagent result for later fork context. */
  addPreviousResult(taskId: string, task: string, result: {
    summary: string
    confidence: number
    filesRead: string[]
    filesChanged: string[]
    issuesFound: string[]
  }): void {
    const references = (values: string[]) => values.slice(0, 12).map(value => value.slice(0, 200))
    this.previousResults.push({
      taskId, task: task.slice(0, 200), summary: result.summary.slice(0, 300), confidence: result.confidence,
      filesRead: references(result.filesRead), filesChanged: references(result.filesChanged), issuesFound: references(result.issuesFound),
    })
  }

  /** Serialize only declared dependency results, in dependency order, within a UTF-8 byte budget. */
  formatForkContext(dependencies?: readonly string[]): string {
    if (!dependencies?.length || this.previousResults.length === 0) return ''
    const byTaskId = new Map(this.previousResults.map(result => [result.taskId, result]))
    const selected: PreviousResult[] = []
    for (const taskId of new Set(dependencies)) {
      const result = byTaskId.get(taskId)
      if (!result) continue
      const candidate = [...selected, result]
      if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > MAX_FORK_CONTEXT_BYTES) break
      selected.push(result)
    }
    return selected.length ? JSON.stringify(selected) : ''
  }

  emit(type: TaskEventType, payload: Record<string, unknown>, taskId?: string): void {
    this.events.emit(type, payload, taskId)
  }

  /** Cancel all unfinished tasks, then flush snapshot and event-log writes. */
  async shutdown(reason = 'Session shutdown'): Promise<void> {
    closeLspSession(this)
    this.registry.cancelAll(reason)
    await this.snapshotStore?.flush()
    await this.events.flush()
  }

  /** Wait for pending snapshot and event-log writes, rethrowing write failures. */
  async flush(): Promise<void> {
    await this.snapshotStore?.flush()
    await this.events.flush()
  }

  get snapshotError(): Error | undefined {
    return this.snapshotStore?.lastError
  }

  /** Queue a snapshot of all tasks and messages; runs after every event and is a no-op without a snapshot file. */
  private queueSnapshot(): void {
    this.snapshotStore?.save(this.sessionId, this.projectRoot, this.registry.listTasks(), this.registry.mailbox.list())
  }

  /** Translate registry events into OrchestratorCallbacks for the UI; for ask_agent tasks, completion and errors are also posted as notes. */
  private routeCompatibilityEvent(type: TaskEventType, taskId: string | undefined, payload: Record<string, unknown>): void {
    if (!taskId) return
    let record
    try { record = this.registry.getStatus(taskId) } catch { return }
    if (type === 'state_changed' && payload.to === 'running') {
      this.callbacks.onStart?.(taskId, String(record.metadata.task ?? record.type), record.metadata.agentName as string | undefined)
    } else if (type === 'tool_started') {
      this.callbacks.onToolUse?.(taskId, String(payload.tool ?? ''), payload.info as string | undefined)
    } else if (type === 'token_progress') {
      this.callbacks.onTokens?.(taskId, Number(payload.tokens ?? 0))
    } else if (type === 'subagent_message') {
      this.callbacks.onMessage?.(taskId, String(payload.role ?? 'assistant'), String(payload.content ?? ''))
    } else if (type === 'completed') {
      const value = record.result?.value
      const text = this.formatValue(value)
      this.callbacks.onDone?.(taskId, text.slice(0, 200), record.metrics.tokens, record.metrics.costAvailable === true ? record.metrics.costUsd : undefined, value)
      if (record.metadata.origin === 'ask_agent') this.callbacks.onNote?.(String(record.metadata.agentName ?? 'agent'), `[task ${taskId}] ${text.slice(0, 500)}`)
    } else if (type === 'error' || type === 'timeout' || type === 'cancelled') {
      const message = record.error?.message ?? String((payload.error as { message?: string } | undefined)?.message ?? type)
      this.callbacks.onError?.(taskId, message)
      if (record.metadata.origin === 'ask_agent') this.callbacks.onNote?.(String(record.metadata.agentName ?? 'agent'), `[task ${taskId}] Error: ${message}`)
    }
  }

  /** Render a task result as text: strings as-is, objects by their `summary` field, anything else as JSON. */
  private formatValue(value: unknown): string {
    if (typeof value === 'string') return value
    if (value && typeof value === 'object' && typeof (value as { summary?: unknown }).summary === 'string') {
      return (value as { summary: string }).summary
    }
    return value === undefined ? '(no output)' : JSON.stringify(value)
  }
}
