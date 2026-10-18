import type { ChildProcess } from 'node:child_process'
import type { ProcessObservation } from './processIdentity.js'
import type { ProviderConfig } from '../types/provider.js'
import type { AskUserHandler } from '../tools/AskUserQuestions/types.js'
import type { PromptImage } from '../types/input.js'

export const TASK_STATES = ['queued', 'running', 'blocked', 'done', 'failed', 'cancelled', 'timed_out'] as const
export type TaskState = typeof TASK_STATES[number]
export type TaskMode = 'foreground' | 'background'
export type TaskContextMode = 'fresh' | 'fork'
export type DependencyFailurePolicy = 'block' | 'fail' | 'cancel'
export type CancellationPolicy = 'cascade' | 'detach'
export type TaskEffectPolicy = 'unknown' | 'tool-gated'
/** `retry-safe` is accepted only when decoding historical snapshots and is never trusted on restore. */
export type PersistedTaskEffectPolicy = TaskEffectPolicy | 'retry-safe'
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
  maxAggregateTokens?: number
  maxAggregateCostUsd?: number
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

export type TaskEffectResolution = 'no-effect' | 'effect-observed' | 'compensated'

export interface TaskEffectReconciliationV1 {
  attempt: number
  resolution: TaskEffectResolution
  evidence: string
  actor: 'user'
  reconciledAt: string
  processSettledAt?: string
}

export interface TaskEffectAttemptV1 {
  id: string
  attempt: number
  tool: string
  state: 'unknown' | 'no-effect' | 'effect-observed'
  startedAt: string
  resolvedAt?: string
  evidence?: string
}

/** Positive-only summary of durable effect receipts in one task's descendant tree. An empty list never means no-effect. */
export interface TaskEffectAggregateV1 {
  taskId: string
  coverage: 'durable-positive-outcomes-only'
  durable: boolean
  parentEffectIdMatches?: boolean
  /** Whether every recorded task in this subtree is terminal, classified, and free of unresolved attempts. */
  allRecordedEffectsSettled: boolean
  positiveEvidence?: string
  observedEffects: Array<{
    taskId: string
    effectId: string
    attempt: number
    tool: string
    evidenceSha256: string
    resolvedAt: string
  }>
  unresolvedAttempts: number
  truncatedTaskIds: string[]
  unclassifiedTaskIds: string[]
  pendingTaskIds: string[]
}

export interface TaskArtifactV1 {
  id: string
  kind: 'file' | 'patch' | 'log' | 'result' | 'other'
  path?: string
  contentHash?: string
  metadata?: Record<string, unknown>
}

export interface ShellWorkspaceObservationV1 {
  schema: 'shell_workspace_observation_v1'
  scope: 'workspace-source-inputs'
  status: 'pending' | 'changed' | 'no-change-observed' | 'unknown'
  cwdRelative: string
  baselineDigest?: string
  observedDigest?: string
  capturedAt?: string
  observedAt?: string
  processGroupSettled: 'settled' | 'unknown'
  fileChangesStatus?: 'complete' | 'unknown'
  /** File paths are relative to this fingerprint root. */
  fileChangesRootRelative?: string
  fileChanges?: Array<{ path: string; change: 'added' | 'modified' | 'removed' }>
  omittedFileChanges?: number
}

export interface ShellExecutionReceiptV1 {
  schema: 'shell_execution_v1'
  state: 'running' | 'completed' | 'unknown' | 'failure'
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  cancelled: boolean
  cwd: string
  projectRoot: string
  workspaceObservation: ShellWorkspaceObservationV1
  executor: {
    kind: 'bubblewrap'
    path?: string
    sha256?: string
    commandExecutable: 'unknown'
  }
  outputPreview?: string
  outputChars: number
  outputTruncated: boolean
  drainTimedOut: boolean
  outputId?: string
  outputArtifact?: {
    kind: 'log'
    totalChars: number
    storedChars: number
    truncated: boolean
    redacted: boolean
    storage: 'disk' | 'recovery-disk' | 'emergency-disk' | 'memory'
  }
}

export interface TaskMetricsV1 {
  model?: string
  provider?: string
  tokens?: number
  costUsd?: number
  /** Token breakdown behind `tokens`, so callers can reprice the usage (eval fixed-price cost). */
  promptTokens?: number
  completionTokens?: number
  cachedTokens?: number
  latencyMs?: number
  usageAvailable: boolean
  /** False when any model response in the task lacked enough usage detail to price accurately. */
  costAvailable?: boolean
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
  parentEffectId?: string
  parentEffectAttempt?: number
  budgetGroupId?: string
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
  effectPolicy?: PersistedTaskEffectPolicy
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
  artifacts?: TaskArtifactV1[]
  partial?: unknown
  effectMayHaveStarted?: boolean
  effectLedger?: TaskEffectAttemptV1[]
  effectLedgerTruncated?: boolean
  effectReconciliations?: TaskEffectReconciliationV1[]
  result?: TaskResultEnvelopeV1<T>
  error?: TaskErrorV1
  blockReason?: string
  workspace?: TaskWorkspaceV1
  process?: ProcessObservation
  metrics: TaskMetricsV1
  metadata: Record<string, unknown>
  dependencyFailurePolicy: DependencyFailurePolicy
  cancellationPolicy: CancellationPolicy
}

export interface SpawnTaskInput {
  taskId?: string
  parentTaskId?: string
  parentEffectId?: string
  budgetGroupId?: string
  type?: string
  mode?: TaskMode
  contextMode?: TaskContextMode
  dependencies?: string[]
  timeoutMs?: number
  maxRetries?: number
  effectPolicy?: TaskEffectPolicy
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
  budgetGroupId: string
  attempt: number
  signal: AbortSignal
  workspacePath: string
  projectRoot: string
  workspaceIsolation?: WorkspaceIsolation
  maxTokens?: number
  maxCostUsd?: number
  runnerEffectId?: string
  sendMessage(type: TaskMessageType, payload: Record<string, unknown>, recipientId?: string): TaskMessageV1
  receiveMessages(status?: TaskMessageStatus): TaskMessageV1[]
  acknowledgeMessage(messageId: string): boolean
  markEffectStarted(tool: string): Promise<string>
  markEffectOutcome(effectId: string, state: 'no-effect' | 'effect-observed', evidence: string): Promise<void>
  trackProcess(child: ChildProcess): void
  setPartial(value: unknown): void
  recordArtifact(artifact: TaskArtifactV1): void
}

/** Content identity captured for a file observation or atomic write. */
export interface FileVersion {
  exists: boolean
  hash: string
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
  | 'message' | 'tool_started' | 'tool_finished' | 'authorization' | 'effect_started' | 'effect_outcome' | 'effect_reconciled' | 'token_progress' | 'subagent_message'
  | 'retry' | 'blocked' | 'timeout' | 'cancelled' | 'completed'
  | 'workspace_created' | 'workspace_updated' | 'workspace_fallback' | 'integration'
  | 'process_observed' | 'artifact_recorded' | 'partial_updated' | 'metadata_updated' | 'metrics_updated' | 'session_rebased' | 'error'

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
  budgetGroupId?: string
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
  /** Optional runtime storage roots for Shell output recovery and deterministic tests. */
  shellOutputRoot?: string
  shellOutputRecoveryRoot?: string
  /** External filesystem roots explicitly approved for this agent session. */
  approvedExternalPaths?: string[]
  /** Runtime-owned state excluded from general file tools, even inside approved roots. */
  protectedPaths?: readonly string[]
  /** Version visible in the latest read_file response for the target being written. */
  expectedFileVersion?: FileVersion
  /** Called after a file mutation commits, while its cooperative lease is held; returned promises are awaited. */
  onFileWriteCommitted?: (filePath: string, version: FileVersion) => void | Promise<void>
  /** Captures the exact version included in a read_file response. */
  onFileReadReturned?: (filePath: string, version: FileVersion) => void
  /** Registers an owned shell child with its task so interruption cannot blindly replay its effects. */
  trackProcess?: (child: ChildProcess) => void
  /** Conservatively prevents automatic retries after an authorized tool may have changed local or remote state. */
  markEffectStarted?: (tool: string) => void | Promise<string | undefined>
  /** Records an integration-verified outcome for the supplied task effect ID. */
  markEffectOutcome?: (effectId: string, state: 'no-effect' | 'effect-observed', evidence: string) => void | Promise<void>
  /** Durably records a bounded native Shell execution receipt before it is acknowledged. */
  recordShellExecution?: (receipt: ShellExecutionReceiptV1) => string | Promise<string>
  /** Attempt-bound identity supplied to the executor for integration-specific effect reconciliation. */
  effectId?: string
  /** Read-only lookup of currently eligible installed tool descriptors; never authorization. */
  discoverTools?: (query: string) => string
  /** Read-only recovery of runtime source records, never tool authorization. */
  readSessionEvidence?: (id?: string, start?: number, limit?: number) => string
  /** Append model-authored claim revisions to this session only; never mutates source evidence or grants. */
  recordSessionClaim?: (claim: import('../agent/sessionEvidence.js').SessionClaim) => string
  /** Record a runtime-produced verification receipt in the owning session; returns its recovery ID. */
  recordVerification?: (result: import('../agent/verify.js').VerificationResult) => string
  session?: import('./OrchestratorSession.js').OrchestratorSession
  workflowManager?: import('../workflows/manager.js').WorkflowManager
  interactionMode?: import('../ui/interactionMode.js').InteractionMode
  askUser?: AskUserHandler
  /** Bot hosts can wait for authenticated remote takeover instead of opening a local window. */
  browserHandoff?: (reason: string) => Promise<boolean>
  skillDirectory?: string
  /** A procedure host checks each native action, including each batch step. Commit only on success. */
  browserStep?: (args: Record<string, unknown>, tab?: import('../browser/tab.js').Tab) => Promise<(() => void | Promise<void>) | undefined>
  browserRecordedStep?: (step: import('../browser/record.js').RecordedStep, pageUrl?: string) => void | Promise<void>
  /** Separate model review required before an agent can mark its goal complete. */
  verifyGoalCompletion?: (completionSummary: string) => Promise<string>
  /**
   * Present only when the model accepts images: queues an image for the next model request.
   * It travels once, labeled as untrusted, and is never stored in the conversation history.
   */
  attachImage?: (image: PromptImage, label: string) => void
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
