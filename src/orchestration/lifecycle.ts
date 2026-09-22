import type { TaskLimits, TaskState } from './types.js'

export const TERMINAL_TASK_STATES = new Set<TaskState>(['done', 'failed', 'cancelled', 'timed_out'])

const TRANSITIONS: Record<TaskState, ReadonlySet<TaskState>> = {
  queued: new Set(['running', 'blocked', 'cancelled']),
  running: new Set(['done', 'failed', 'blocked', 'cancelled', 'timed_out']),
  blocked: new Set(['queued', 'failed', 'cancelled']),
  done: new Set(),
  failed: new Set(['queued']),
  cancelled: new Set(['queued']),
  timed_out: new Set(['queued']),
}

/** Whether the task state machine allows `from` -> `to`. `done` is final; failed, cancelled and timed_out tasks can only be re-queued. */
export function canTransition(from: TaskState, to: TaskState): boolean {
  return TRANSITIONS[from].has(to)
}

/** Truncate to an integer and clamp into [min, max]; throws INVALID_LIMIT for non-finite input. */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) throw new TaskRuntimeError('INVALID_LIMIT', `Invalid numeric limit: ${value}`)
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

/** Validate an optional positive budget (undefined means unlimited); throws INVALID_LIMIT for non-positive or non-finite values. */
function optionalBudget(value: number | undefined, name: string, integer = false): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value <= 0 || (integer && value < 1)) throw new TaskRuntimeError('INVALID_LIMIT', `Invalid ${name}: ${value}`)
  return integer ? Math.trunc(value) : value
}

/** Clamp every numeric limit into its supported range and validate the optional token and cost budgets. */
export function normalizeTaskLimits(limits: TaskLimits): TaskLimits {
  return {
    ...limits,
    concurrency: clamp(limits.concurrency, 1, 32), maxTasks: clamp(limits.maxTasks, 1, 10_000),
    maxDepth: clamp(limits.maxDepth, 0, 32), maxFanOut: clamp(limits.maxFanOut, 1, 100),
    maxRetries: clamp(limits.maxRetries, 0, 10), timeoutMs: clamp(limits.timeoutMs, 1, 86_400_000),
    retryBackoffMs: clamp(limits.retryBackoffMs, 0, 60_000),
    maxTokens: optionalBudget(limits.maxTokens, 'token budget', true),
    maxCostUsd: optionalBudget(limits.maxCostUsd, 'cost budget'),
  }
}

/** Task error with a machine-readable code and a retryable flag; `toTaskError` maps it onto TaskErrorV1. */
export class TaskRuntimeError extends Error {
  constructor(readonly code: string, message: string, readonly retryable = false) {
    super(message)
    this.name = 'TaskRuntimeError'
  }
}

/** Thrown when a state change is not allowed by the task lifecycle state machine. */
export class InvalidTaskTransitionError extends Error {
  constructor(taskId: string, from: TaskState, to: TaskState) {
    super(`Invalid task transition for '${taskId}': ${from} -> ${to}`)
    this.name = 'InvalidTaskTransitionError'
  }
}
