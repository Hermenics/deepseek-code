import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ProviderConfig } from '../types/provider.js'
import type { DeepSeekSettings } from '../settings/types.js'
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
  ToolExecutionContext,
} from './types.js'

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
  sessionId?: string
  projectRoot?: string
  providerConfig?: ProviderConfig
  model?: string
  settings?: DeepSeekSettings
  limits?: Partial<TaskLimits>
  logFile?: string | null
  snapshotFile?: string | null
}

export function taskSnapshotFile(sessionId: string): string {
  const key = createHash('sha256').update(sessionId).digest('hex').slice(0, 32)
  return join(homedir(), '.deepseek', 'task-snapshots', `${key}.json`)
}

interface PreviousResult {
  task: string
  summary: string
  confidence: number
}

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

  constructor(options: OrchestratorSessionOptions = {}) {
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
    this.registry = new TaskRegistry({ sessionId: this.sessionId, projectRoot: this.projectRoot, limits: options.limits, events: this.events })
    this.workspaces = new TaskWorkspaceManager(this.projectRoot, this.sessionId, this.events)
    this.memory = new MemoryStore(this.projectRoot)
    this.snapshotStore = options.snapshotFile ? new TaskSnapshotStore(options.snapshotFile) : undefined
    this.events.subscribe(event => {
      this.routeCompatibilityEvent(event.type, event.taskId, event.payload)
      this.queueSnapshot()
    })
  }

  /** Rebuild a session from a snapshot file, marking interrupted tasks failed and re-deriving the generic agent counter. */
  static async restore(options: OrchestratorSessionOptions & { snapshotFile: string; projectRoot: string; runnerResolver?: TaskRunnerResolver }): Promise<OrchestratorSession> {
    const snapshot = await TaskSnapshotStore.read(options.snapshotFile)
    if (options.sessionId && options.sessionId !== snapshot.sessionId) throw new Error('Snapshot sessionId does not match requested session')
    if (resolve(options.projectRoot) !== resolve(snapshot.projectRoot)) throw new Error('Snapshot projectRoot does not match requested project')
    const session = new OrchestratorSession({ ...options, sessionId: snapshot.sessionId, projectRoot: snapshot.projectRoot })
    session.registry.restoreTasks(snapshot.tasks, options.runnerResolver)
    session.registry.mailbox.restore(snapshot.messages)
    session.workspaces.restore(snapshot.tasks)
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
    this.syncGenericCounterFromTasks()
    this.restored = true
    this.queueSnapshot()
    return true
  }

  configure(values: { providerConfig?: ProviderConfig; model?: string; settings?: DeepSeekSettings; limits?: Partial<TaskLimits> }): void {
    if (values.providerConfig) this.providerConfig = values.providerConfig
    if (values.model) this.model = values.model
    if (values.settings) this.settings = structuredClone(values.settings)
    if (values.limits) this.registry.updateLimits(values.limits)
  }

  async changeProjectRoot(path: string): Promise<void> {
    const target = resolve(path)
    const active = this.registry.listTasks().filter(task => !['done', 'failed', 'cancelled', 'timed_out'].includes(task.state))
    if (active.length > 0) throw new Error(`Cannot change project root while ${active.length} task(s) are active`)
    const anchored = this.registry.listTasks().filter(task =>
      task.workspace?.isolation !== 'readonly-shared' && task.workspace && resolve(task.workspace.projectRoot) !== target,
    )
    if (anchored.length > 0) throw new Error(`Cannot change project root while ${anchored.length} task workspace(s) remain anchored to the current project`)
    const previous = this.projectRoot
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

  async acquireWorkspace(taskId: string, profile: PermissionProfile, signal?: AbortSignal): Promise<WorkspaceLease> {
    const lease = await this.workspaces.acquire(taskId, profile, signal)
    this.registry.setWorkspace(taskId, lease.workspace)
    return lease
  }

  async integrateTask(taskId: string): Promise<IntegrationResult> {
    const result = await this.workspaces.integrate(taskId)
    const workspace = this.workspaces.get(taskId)
    if (workspace) this.registry.setWorkspace(taskId, workspace)
    this.registry.updateMetadata(taskId, { integration: result })
    return result
  }

  async cleanupTaskWorkspace(taskId: string): Promise<boolean> {
    const cleaned = await this.workspaces.cleanup(taskId)
    if (cleaned) this.registry.clearWorkspace(taskId)
    return cleaned
  }

  toolContext(input: { taskId?: string; workspacePath?: string; workspaceIsolation?: ToolExecutionContext['workspaceIsolation']; signal?: AbortSignal; permissionProfile?: PermissionProfile; allowedTools?: string[] | '*'; maxTokens?: number; maxCostUsd?: number; dangerousOperationApproved?: boolean; approvedExternalPaths?: string[]; workflowManager?: ToolExecutionContext['workflowManager']; interactionMode?: ToolExecutionContext['interactionMode'] } = {}): ToolExecutionContext {
    return {
      sessionId: this.sessionId,
      taskId: input.taskId,
      workspacePath: input.workspacePath ?? this.projectRoot,
      projectRoot: this.projectRoot,
      workspaceIsolation: input.workspaceIsolation,
      signal: input.signal,
      permissionProfile: input.permissionProfile ?? 'coordinator-integrator',
      allowedTools: input.allowedTools,
      model: this.model,
      maxTokens: input.maxTokens,
      maxCostUsd: input.maxCostUsd,
      dangerousOperationApproved: input.dangerousOperationApproved,
      approvedExternalPaths: input.approvedExternalPaths,
      workflowManager: input.workflowManager,
      interactionMode: input.interactionMode,
      session: this,
      emit: (type, payload) => this.events.emit(type, payload, input.taskId),
    }
  }

  runtimeSnapshot(): { providerConfig: ProviderConfig; model?: string; settings: DeepSeekSettings } {
    return {
      providerConfig: structuredClone(this.providerConfig),
      model: this.model,
      settings: structuredClone(this.settings),
    }
  }

  resetTurnMemory(): void {
    this.previousResults = []
  }

  addPreviousResult(task: string, summary: string, confidence: number): void {
    this.previousResults.push({ task: task.slice(0, 200), summary: summary.slice(0, 300), confidence })
  }

  formatForkContext(): string {
    if (this.previousResults.length === 0) return ''
    return JSON.stringify(this.previousResults.map(result => ({
      task: result.task, summary: result.summary, confidence: result.confidence,
    })))
  }

  emit(type: TaskEventType, payload: Record<string, unknown>, taskId?: string): void {
    this.events.emit(type, payload, taskId)
  }

  async shutdown(reason = 'Session shutdown'): Promise<void> {
    this.registry.cancelAll(reason)
    await this.snapshotStore?.flush()
    await this.events.flush()
  }

  async flush(): Promise<void> {
    await this.snapshotStore?.flush()
    await this.events.flush()
  }

  get snapshotError(): Error | undefined {
    return this.snapshotStore?.lastError
  }

  private queueSnapshot(): void {
    this.snapshotStore?.save(this.sessionId, this.projectRoot, this.registry.listTasks(), this.registry.mailbox.list())
  }

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
      this.callbacks.onDone?.(taskId, text.slice(0, 200), record.metrics.tokens, record.metrics.costUsd, value)
      if (record.metadata.origin === 'ask_agent') this.callbacks.onNote?.(String(record.metadata.agentName ?? 'agent'), `[task ${taskId}] ${text.slice(0, 500)}`)
    } else if (type === 'error' || type === 'timeout' || type === 'cancelled') {
      const message = record.error?.message ?? String((payload.error as { message?: string } | undefined)?.message ?? type)
      this.callbacks.onError?.(taskId, message)
      if (record.metadata.origin === 'ask_agent') this.callbacks.onNote?.(String(record.metadata.agentName ?? 'agent'), `[task ${taskId}] Error: ${message}`)
    }
  }

  private formatValue(value: unknown): string {
    if (typeof value === 'string') return value
    if (value && typeof value === 'object' && typeof (value as { summary?: unknown }).summary === 'string') {
      return (value as { summary: string }).summary
    }
    return value === undefined ? '(no output)' : JSON.stringify(value)
  }
}
