export const WORKFLOW_STATUSES = [
  'queued', 'running', 'paused', 'completed', 'failed', 'cancelled', 'timed_out', 'budget_exhausted',
] as const

export type WorkflowStatus = typeof WORKFLOW_STATUSES[number]

export interface WorkflowPhaseMeta {
  title: string
  detail?: string
  /** Model override applied to agents in this phase that do not set their own. */
  model?: string
}

export interface WorkflowMeta {
  name: string
  description?: string
  /** Shown in the workflow list so the model knows when a saved workflow applies. */
  whenToUse?: string
  /** Declared phase skeleton; lets the monitor show phases that have not started yet. */
  phases?: WorkflowPhaseMeta[]
}

export const WORKFLOW_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type WorkflowEffort = typeof WORKFLOW_EFFORT_LEVELS[number]

export interface WorkflowAgentOptions {
  label?: string
  phase?: string
  schema?: object
  model?: string
  effort?: WorkflowEffort
  isolation?: 'worktree'
  agentType?: string
  timeoutMs?: number
  maxTokens?: number
  maxCostUsd?: number
}

/** A child workflow reference: a saved workflow name or a script file the model wrote earlier. */
export type WorkflowRef = string | { scriptPath: string }

export interface WorkflowUsage {
  agents: number
  tokens: number
  costUsd: number
}

export interface WorkflowFailure {
  call: number
  method: string
  message: string
}

export interface WorkflowWorktree {
  taskId: string
  path: string
}

export interface WorkflowRunOptions {
  name?: string
  timeoutMs?: number
  maxTokens?: number
  maxCostUsd?: number
}

export interface WorkflowRun {
  runId: string
  sessionId: string
  projectRoot: string
  meta: WorkflowMeta
  status: WorkflowStatus
  phase?: string
  /** Ordered phases already emitted by the workflow runtime. */
  phaseHistory?: string[]
  scriptHash: string
  argsHash: string
  optionsHash: string
  options: WorkflowRunOptions
  createdAt: string
  startedAt?: string
  completedAt?: string
  usage: WorkflowUsage
  failures: WorkflowFailure[]
  worktrees: WorkflowWorktree[]
  result?: unknown
  error?: string
}

export interface WorkflowResult {
  runId: string
  status: WorkflowStatus
  result: unknown
  error?: string
  usage: WorkflowUsage
  failures: WorkflowFailure[]
  worktrees: WorkflowWorktree[]
  /** Persisted copy of the executed script; edit it and relaunch with resumeFromRunId to iterate. */
  scriptPath?: string
  /** Journal with every agent call's arguments and actual return value. */
  journalPath?: string
}

export interface WorkflowEvent {
  type: 'phase' | 'log'
  value: string
  timestamp: string
}

export interface WorkflowRpcUsage {
  agents?: number
  tokens?: number
  costUsd?: number
}

export interface WorkflowRpcResult {
  value: unknown
  usage?: WorkflowRpcUsage
}
