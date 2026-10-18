import { TaskRuntimeError } from './lifecycle.js'
import { validateTaskResultEnvelope } from './schema.js'
import type { TaskSlot } from './runtimeSlot.js'
import type { TaskArtifactV1, TaskErrorV1, TaskRecordV1, TaskResultEnvelopeV1 } from './types.js'

const RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNREFUSED', 'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET',
  'UNAVAILABLE', 'RESOURCE_EXHAUSTED', 'DEADLINE_EXCEEDED', 'ABORTED',
])
const RETRYABLE_ERROR_NAMES = new Set(['APIConnectionError', 'APIConnectionTimeoutError', 'InternalServerError', 'RateLimitError'])

/** Turn a runner's output into a 'done' result envelope. A runner may return its own envelope, which must validate and match this task, session and status 'done'; any other value is wrapped. Metrics are merged, keeping the registry-measured latency. */
export function normalizeTaskResult(slot: TaskSlot, sessionId: string, output: unknown): TaskResultEnvelopeV1 {
  if (output && typeof output === 'object' && (output as { schemaVersion?: number }).schemaVersion === 1 && 'status' in output) {
    const supplied = output as TaskResultEnvelopeV1
    const validation = validateTaskResultEnvelope(supplied)
    if (!validation.valid) throw new TaskRuntimeError('INVALID_RESULT', `Runner returned an invalid result envelope: ${validation.errors.join('; ')}`)
    if (supplied.taskId !== slot.record.taskId || supplied.sessionId !== sessionId || supplied.status !== 'done') {
      throw new TaskRuntimeError('INVALID_RESULT', 'Runner returned an envelope with mismatched identity or status')
    }
    const artifacts = mergeArtifacts(slot.record.artifacts ?? [], supplied.artifacts)
    slot.record.artifacts = structuredClone(artifacts)
    slot.record.artifactRefs = [...new Set([...slot.record.artifactRefs, ...artifacts.map(artifact => artifact.id)])]
    slot.record.partial = structuredClone(supplied.partial ?? slot.record.partial)
    return {
      ...structuredClone(supplied),
      partial: structuredClone(slot.record.partial), artifacts,
      metrics: { ...slot.record.metrics, ...supplied.metrics, latencyMs: slot.record.metrics.latencyMs ?? supplied.metrics.latencyMs },
    }
  }
  slot.record.partial = structuredClone(slot.record.partial ?? slot.partial)
  return {
    schemaVersion: 1, taskId: slot.record.taskId, sessionId, status: 'done',
    value: structuredClone(output), partial: structuredClone(slot.record.partial ?? slot.partial), artifacts: structuredClone(slot.record.artifacts ?? []),
    metrics: { ...slot.record.metrics }, completedAt: new Date().toISOString(),
  }
}

/** Build a failed/cancelled/timed_out envelope and store it on the slot's record. Throws DOUBLE_COMPLETION if the current attempt already settled with a result. */
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
  slot.record.partial = structuredClone(slot.record.partial ?? slot.partial)
  const envelope: TaskResultEnvelopeV1 = {
    schemaVersion: 1, taskId: slot.record.taskId, sessionId, status: state,
    value, partial: structuredClone(slot.record.partial ?? slot.partial), artifacts: structuredClone(slot.record.artifacts ?? []), metrics: { ...slot.record.metrics }, error,
    completedAt: new Date().toISOString(),
  }
  slot.record.result = envelope
  return envelope
}

function mergeArtifacts(...groups: TaskArtifactV1[][]): TaskArtifactV1[] {
  const byId = new Map<string, TaskArtifactV1>()
  for (const artifact of groups.flat()) byId.set(artifact.id, structuredClone(artifact))
  return [...byId.values()]
}

/** Convert thrown values into task errors; generic failures retry only when a known transient signal is present. */
export function toTaskError(cause: unknown): TaskErrorV1 {
  if (cause instanceof TaskRuntimeError) return { code: cause.code, message: cause.message, retryable: cause.retryable }
  const error = cause instanceof Error ? cause : new Error(String(cause))
  return { code: 'TASK_FAILED', message: error.message, retryable: hasTransientFailureSignal(cause), cause: error.name }
}

function hasTransientFailureSignal(cause: unknown): boolean {
  const seen = new Set<object>()
  let current = cause
  for (let depth = 0; depth < 8 && current && typeof current === 'object' && !seen.has(current); depth++) {
    const candidate = current as Record<string, unknown>
    seen.add(candidate)
    if (typeof candidate.retryable === 'boolean') return candidate.retryable
    if (candidate.$retryable === true || (candidate.$retryable !== null && typeof candidate.$retryable === 'object')) return true
    const metadata = candidate.$metadata && typeof candidate.$metadata === 'object' ? candidate.$metadata as Record<string, unknown> : undefined
    const status = [candidate.status, candidate.statusCode, candidate.status_code, metadata?.httpStatusCode].find(value => typeof value === 'number')
    if (typeof status === 'number') return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599)
    const constructor = candidate.constructor
    const name = typeof candidate.name === 'string' ? candidate.name : typeof constructor === 'function' ? constructor.name : undefined
    if (typeof name === 'string' && RETRYABLE_ERROR_NAMES.has(name)) return true
    if (typeof candidate.code === 'string' && RETRYABLE_ERROR_CODES.has(candidate.code)) return true
    current = candidate.cause
  }
  return false
}

/** Throw when a configured task budget is exceeded or its usage metric is unavailable. */
export function enforceTaskBudget(record: TaskRecordV1, result: TaskResultEnvelopeV1): void {
  if (record.maxTokens !== undefined && result.metrics.tokens !== undefined && result.metrics.tokens > record.maxTokens) {
    throw new TaskRuntimeError('TOKEN_BUDGET_EXCEEDED', `Task used ${result.metrics.tokens} tokens; limit is ${record.maxTokens}`)
  }
  if (record.maxTokens !== undefined && (result.metrics.tokens === undefined || result.metrics.usageAvailable !== true)) {
    throw new TaskRuntimeError('TOKEN_BUDGET_UNAVAILABLE', 'Task completed without token usage for every model response; token budget cannot be verified')
  }
  if (record.maxCostUsd !== undefined) {
    if (result.metrics.costUsd !== undefined) {
      if (result.metrics.costUsd > record.maxCostUsd) {
        throw new TaskRuntimeError('COST_BUDGET_EXCEEDED', `Task cost $${result.metrics.costUsd}; limit is $${record.maxCostUsd}`)
      }
    }
    if (result.metrics.costUsd === undefined || result.metrics.costAvailable !== true) {
      throw new TaskRuntimeError('COST_BUDGET_UNAVAILABLE', 'Task completed without priceable usage for every model response; cost budget cannot be verified')
    }
  }
}
