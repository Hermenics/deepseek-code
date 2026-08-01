import { TaskRuntimeError } from './lifecycle.js'
import { validateTaskResultEnvelope } from './schema.js'
import type { TaskSlot } from './runtimeSlot.js'
import type { TaskErrorV1, TaskRecordV1, TaskResultEnvelopeV1 } from './types.js'

export function normalizeTaskResult(slot: TaskSlot, sessionId: string, output: unknown): TaskResultEnvelopeV1 {
  if (output && typeof output === 'object' && (output as { schemaVersion?: number }).schemaVersion === 1 && 'status' in output) {
    const supplied = output as TaskResultEnvelopeV1
    const validation = validateTaskResultEnvelope(supplied)
    if (!validation.valid) throw new TaskRuntimeError('INVALID_RESULT', `Runner returned an invalid result envelope: ${validation.errors.join('; ')}`)
    if (supplied.taskId !== slot.record.taskId || supplied.sessionId !== sessionId || supplied.status !== 'done') {
      throw new TaskRuntimeError('INVALID_RESULT', 'Runner returned an envelope with mismatched identity or status')
    }
    return {
      ...structuredClone(supplied),
      metrics: { ...slot.record.metrics, ...supplied.metrics, latencyMs: slot.record.metrics.latencyMs ?? supplied.metrics.latencyMs },
    }
  }
  return {
    schemaVersion: 1, taskId: slot.record.taskId, sessionId, status: 'done',
    value: structuredClone(output), partial: slot.partial, artifacts: [],
    metrics: { ...slot.record.metrics }, completedAt: new Date().toISOString(),
  }
}

export function createFailureEnvelope(
  slot: TaskSlot,
  state: 'failed' | 'cancelled' | 'timed_out',
  sessionId: string,
  value: unknown,
  error: TaskErrorV1,
): TaskResultEnvelopeV1 {
  if (slot.settledAttempt === slot.record.attempt && slot.record.result) {
    throw new TaskRuntimeError('DOUBLE_COMPLETION', `Task '${slot.record.taskId}' already completed attempt ${slot.record.attempt}`)
  }
  slot.settledAttempt = slot.record.attempt
  slot.record.error = error
  const envelope: TaskResultEnvelopeV1 = {
    schemaVersion: 1, taskId: slot.record.taskId, sessionId, status: state,
    value, partial: slot.partial, artifacts: [], metrics: { ...slot.record.metrics }, error,
    completedAt: new Date().toISOString(),
  }
  slot.record.result = envelope
  return envelope
}

export function toTaskError(cause: unknown): TaskErrorV1 {
  if (cause instanceof TaskRuntimeError) return { code: cause.code, message: cause.message, retryable: cause.retryable }
  const error = cause instanceof Error ? cause : new Error(String(cause))
  return { code: 'TASK_FAILED', message: error.message, retryable: true, cause: error.name }
}

export function enforceTaskBudget(record: TaskRecordV1, result: TaskResultEnvelopeV1): void {
  if (record.maxTokens !== undefined && result.metrics.tokens !== undefined && result.metrics.tokens > record.maxTokens) {
    throw new TaskRuntimeError('TOKEN_BUDGET_EXCEEDED', `Task used ${result.metrics.tokens} tokens; limit is ${record.maxTokens}`)
  }
  if (record.maxCostUsd !== undefined) {
    if (result.metrics.costUsd !== undefined) {
      if (result.metrics.costUsd > record.maxCostUsd) {
        throw new TaskRuntimeError('COST_BUDGET_EXCEEDED', `Task cost $${result.metrics.costUsd}; limit is $${record.maxCostUsd}`)
      }
    }
    // When cost budget is requested but provider cannot report cost,
    // the budget is unenforceable. usageAvailable remains false.
  }
}
