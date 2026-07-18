import type { ProviderConfig } from '../types/provider.js'

export const TASK_STATES = ['queued', 'running', 'blocked', 'done', 'failed', 'cancelled', 'timed_out'] as const
export type TaskState = typeof TASK_STATES[number]
export type TaskMode = 'foreground' | 'background'
export type TaskContextMode = 'fresh' | 'fork'
export type DependencyFailurePolicy = 'block' | 'fail' | 'cancel'
export type CancellationPolicy = 'cascade' | 'detach'
export type PermissionProfile = 'researcher-readonly' | 'tester' | 'writer-worktree' | 'coordinator-integrator'
export type WorkspaceIsolation = 'readonly-shared' | 'git-worktree' | 'serialized-writer'

export interface TaskLimits {
  concurrency: number
  maxTasks: number
  maxDepth: number
  maxFanOut: number
  maxRetries: number
  timeoutMs: number
  retryBackoffMs: number
  maxTokens?: number
  maxCostUsd?: number
}

export const DEFAULT_TASK_LIMITS: TaskLimits = {
  concurrency: 5,
  maxTasks: 17,
  maxDepth: 2,
  maxFanOut: 5,
  maxRetries: 1,
  timeoutMs: 120_000,
  retryBackoffMs: 250,
}

export interface TaskErrorV1 {
  code: string
  message: string
  retryable: boolean
  cause?: string
}

export interface TaskArtifactV1 {
  id: string
  kind: 'file' | 'patch' | 'log' | 'result' | 'other'
  path?: string
  contentHash?: string
  metadata?: Record<string, unknown>
}

export interface TaskMetricsV1 {
  model?: string
  provider?: string
  tokens?: number
  costUsd?: number
  latencyMs?: number
  usageAvailable: boolean
}

export interface TaskResultEnvelopeV1<T = unknown> {
  schemaVersion: 1
  taskId: string
  sessionId: string
  status: Extract<TaskState, 'done' | 'failed' | 'cancelled' | 'timed_out'>
  value?: T
  partial?: unknown
  artifacts: TaskArtifactV1[]
  metrics: TaskMetricsV1
  error?: TaskErrorV1
  rawOutput?: string
  completedAt: string
}

export type TaskMessageType = 'progress' | 'result' | 'blocked' | 'question' | 'error' | 'cancel' | 'permission' | 'resource'
export type TaskMessageStatus = 'pending' | 'processed'

export interface TaskMessageV1 {
  schemaVersion: 1
  messageId: string
  senderId: string
  recipientId: string
  type: TaskMessageType
  correlationId: string
  taskId: string
  timestamp: string
  payload: Record<string, unknown>
  status: TaskMessageStatus
}

export interface TaskWorkspaceV1 {
  path: string
  projectRoot: string
  isolation: WorkspaceIsolation
  baseHead?: string
  integrated?: boolean
  preserved?: boolean
}

export interface TaskRecordV1<T = unknown> {
  schemaVersion: 1
  taskId: string
  sessionId: string
  parentTaskId?: string
  type: string
  mode: TaskMode
  contextMode: TaskContextMode
  state: TaskState
  depth: number
  dependencies: string[]
  dependents: string[]
  createdAt: string
  queuedAt: string
  startedAt?: string
  updatedAt: string
  completedAt?: string
  deadline?: string
  attempt: number
  maxRetries: number
  timeoutMs: number
  maxDepth: number
  maxFanOut: number
  allowDelegation: boolean
  maxTokens?: number
  maxCostUsd?: number
  permissionProfile: PermissionProfile
  allowedTools?: string[] | '*'
  contextSummary?: string
  artifactRefs: string[]
  result?: TaskResultEnvelopeV1<T>
  error?: TaskErrorV1
  blockReason?: string
  workspace?: TaskWorkspaceV1
  metrics: TaskMetricsV1
  metadata: Record<string, unknown>
  dependencyFailurePolicy: DependencyFailurePolicy
  cancellationPolicy: CancellationPolicy
}

export interface SpawnTaskInput {
  taskId?: string
  parentTaskId?: string
  type?: string
  mode?: TaskMode
  contextMode?: TaskContextMode
  dependencies?: string[]
  timeoutMs?: number
  maxRetries?: number
  maxDepth?: number
  maxFanOut?: number
  allowDelegation?: boolean
  maxTokens?: number
  maxCostUsd?: number
  permissionProfile?: PermissionProfile
  allowedTools?: string[] | '*'
  contextSummary?: string
  artifactRefs?: string[]
  metadata?: Record<string, unknown>
  dependencyFailurePolicy?: DependencyFailurePolicy
  cancellationPolicy?: CancellationPolicy
}

export interface TaskRunContext {
  sessionId: string
  taskId: string
  attempt: number
  signal: AbortSignal
  workspacePath: string
  projectRoot: string
  workspaceIsolation?: WorkspaceIsolation
  maxTokens?: number
  maxCostUsd?: number
  sendMessage(type: TaskMessageType, payload: Record<string, unknown>, recipientId?: string): TaskMessageV1
  receiveMessages(status?: TaskMessageStatus): TaskMessageV1[]
  acknowledgeMessage(messageId: string): boolean
  setPartial(value: unknown): void
}

export type TaskRunner<T = unknown> = (context: TaskRunContext) => Promise<T | TaskResultEnvelopeV1<T>>
export type TaskRunnerResolver = (record: TaskRecordV1) => TaskRunner | undefined

export interface TaskSessionSnapshotV1 {
  schemaVersion: 1
  sessionId: string
  projectRoot: string
  savedAt: string
  tasks: TaskRecordV1[]
  messages: TaskMessageV1[]
}

export type TaskEventType =
  | 'task_created' | 'state_changed' | 'attempt_started' | 'attempt_finished'
  | 'message' | 'tool_started' | 'tool_finished' | 'authorization'
  | 'retry' | 'blocked' | 'timeout' | 'cancelled' | 'completed'
  | 'workspace_created' | 'workspace_updated' | 'workspace_fallback' | 'integration'
  | 'metadata_updated' | 'metrics_updated' | 'session_rebased' | 'error'

export interface TaskEventV1 {
  schemaVersion: 1
  eventId: string
  sessionId: string
  taskId?: string
  parentTaskId?: string
  correlationId: string
  type: TaskEventType
  timestamp: string
  payload: Record<string, unknown>
}

export interface ToolExecutionContext {
  sessionId: string
  taskId?: string
  workspacePath: string
  projectRoot: string
  workspaceIsolation?: WorkspaceIsolation
  signal?: AbortSignal
  permissionProfile: PermissionProfile
  allowedTools?: string[] | '*'
  providerConfig?: ProviderConfig
  model?: string
  maxTokens?: number
  maxCostUsd?: number
  dangerousOperationApproved?: boolean
  session?: import('./OrchestratorSession.js').OrchestratorSession
  emit?(type: TaskEventType, payload: Record<string, unknown>): void
}

export interface TaskHandle<T = unknown> {
  readonly taskId: string
  readonly sessionId: string
  status(): TaskRecordV1<T>
  awaitResult(): Promise<TaskResultEnvelopeV1<T>>
  cancel(reason?: string): boolean
  sendMessage(type: TaskMessageType, payload: Record<string, unknown>, recipientId?: string, messageId?: string): TaskMessageV1
  resume(): boolean
  getResult(): TaskResultEnvelopeV1<T> | undefined
}
