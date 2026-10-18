import { TaskRuntimeError } from './lifecycle.js'
import { CONVERSATION_MESSAGE_BYTES } from '../agent/toolOutputBudget.js'

/** Four complete per-request payloads fit in one primary turn's shared byte budget. */
export const AGGREGATE_TURN_BYTES = 4 * CONVERSATION_MESSAGE_BYTES
/** @deprecated Use AGGREGATE_TURN_BYTES; request and captured output share this pool. */
export const AGGREGATE_REQUEST_BYTES = AGGREGATE_TURN_BYTES

export interface AggregateBudgetLimits {
  maxAggregateTokens?: number
  maxAggregateCostUsd?: number
}

export interface AggregateBudgetUsage {
  tokens?: number
  costUsd?: number
}

export interface AggregateBudgetLease {
  /** Remaining aggregate total, suitable only as a completion-token cap; prompt usage is unknown until the provider responds. */
  maxTokens?: number
  // shortcut: prompt tokens and cost have no trusted preflight count, upgrade when each configured provider supplies one.
  /** Explicit name for callers that need to cap generated output before dispatch. */
  maxCompletionTokens?: number
  maxCostUsd?: number
  /** Reserve the exact UTF-8 size of one complete serialized provider body before dispatch. */
  reserveRequestBytes(bytes: number): number
  reportUsage(usage: AggregateBudgetUsage): { exceeded: boolean; exhausted: boolean; unavailable: boolean }
  release(): void
}

interface Waiter {
  resolve(release: () => void): void
  reject(reason: unknown): void
  signal?: AbortSignal
  onAbort?: () => void
}

class AsyncMutex {
  private locked = false
  private readonly waiters: Waiter[] = []

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new TaskRuntimeError('CANCELLED', 'Budget request was cancelled'))
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal }
      if (!this.locked) {
        this.locked = true
        this.grant(waiter)
        return
      }
      if (signal) {
        waiter.onAbort = () => {
          const index = this.waiters.indexOf(waiter)
          if (index !== -1) this.waiters.splice(index, 1)
          reject(signal.reason ?? new TaskRuntimeError('CANCELLED', 'Budget request was cancelled'))
        }
        signal.addEventListener('abort', waiter.onAbort, { once: true })
      }
      this.waiters.push(waiter)
    })
  }

  private grant(waiter: Waiter): void {
    if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort)
    let released = false
    waiter.resolve(() => {
      if (released) return
      released = true
      const next = this.waiters.shift()
      if (next) this.grant(next)
      else this.locked = false
    })
  }
}

/** Serializes model requests in one task group and carries usage forward across sibling workers. */
export class TaskAggregateBudget {
  private readonly mutex = new AsyncMutex()

  constructor(
    private usedTokens = 0,
    private usedCostUsd = 0,
    private unavailable = false,
    private usedBytes = 0,
  ) {}

  /** Charge observed output only when the full byte count fits in the shared turn pool. */
  recordOutputBytes(bytes: number): boolean {
    if (!Number.isSafeInteger(bytes) || bytes < 0) return false
    if (bytes > AGGREGATE_TURN_BYTES - this.usedBytes) {
      this.usedBytes = AGGREGATE_TURN_BYTES
      return false
    }
    this.usedBytes += bytes
    return true
  }

  async acquire(limits: AggregateBudgetLimits, signal?: AbortSignal): Promise<AggregateBudgetLease> {
    const unlock = await this.mutex.acquire(signal)
    const release = () => unlock()
    const fail = (code: string, message: string): never => { release(); throw new TaskRuntimeError(code, message) }
    if (this.unavailable) fail('AGGREGATE_BUDGET_UNAVAILABLE', 'Prior model usage in this task group could not be measured; no further model calls are allowed')
    if (limits.maxAggregateTokens !== undefined && this.usedTokens >= limits.maxAggregateTokens) {
      fail('AGGREGATE_BUDGET_EXHAUSTED', `Task group used ${this.usedTokens} tokens; aggregate limit is ${limits.maxAggregateTokens}`)
    }
    if (limits.maxAggregateCostUsd !== undefined && this.usedCostUsd >= limits.maxAggregateCostUsd) {
      fail('AGGREGATE_BUDGET_EXHAUSTED', `Task group cost $${this.usedCostUsd.toFixed(4)} reached aggregate limit $${limits.maxAggregateCostUsd}`)
    }

    let isReleased = false
    let usageReported = false
    let requestBytesReserved = false
    const maxCompletionTokens = limits.maxAggregateTokens === undefined ? undefined : Math.floor(limits.maxAggregateTokens - this.usedTokens)
    return {
      maxTokens: maxCompletionTokens,
      maxCompletionTokens,
      maxCostUsd: limits.maxAggregateCostUsd === undefined ? undefined : limits.maxAggregateCostUsd - this.usedCostUsd,
      reserveRequestBytes: bytes => {
        if (isReleased) throw new TaskRuntimeError('BUDGET_LEASE_RELEASED', 'Cannot reserve request bytes after releasing the aggregate budget lease')
        if (requestBytesReserved) throw new TaskRuntimeError('BUDGET_REQUEST_SIZE_REPORTED', 'Request bytes can be reserved only once per model request')
        if (!Number.isSafeInteger(bytes) || bytes <= 0) {
          throw new TaskRuntimeError('AGGREGATE_BUDGET_UNAVAILABLE', 'A valid serialized request size is required before model dispatch')
        }
        if (bytes > AGGREGATE_TURN_BYTES - this.usedBytes) {
          throw new TaskRuntimeError('AGGREGATE_REQUEST_BYTES_EXCEEDED', `Serialized provider requests exceed the ${AGGREGATE_TURN_BYTES / (1024 * 1024)} MiB per-turn UTF-8 limit`)
        }
        this.usedBytes += bytes
        requestBytesReserved = true
        return AGGREGATE_TURN_BYTES - this.usedBytes
      },
      reportUsage: usage => {
        if (isReleased) throw new TaskRuntimeError('BUDGET_LEASE_RELEASED', 'Cannot report usage after releasing the aggregate budget lease')
        if (usageReported) throw new TaskRuntimeError('BUDGET_USAGE_REPORTED', 'Aggregate usage can be reported only once per model request')
        usageReported = true
        const validTokens = typeof usage.tokens === 'number' && Number.isSafeInteger(usage.tokens) && usage.tokens >= 0
        const validCost = typeof usage.costUsd === 'number' && Number.isFinite(usage.costUsd) && usage.costUsd >= 0
        if (limits.maxAggregateTokens !== undefined && !validTokens) this.unavailable = true
        if (limits.maxAggregateCostUsd !== undefined && !validCost) this.unavailable = true
        if (validTokens) this.usedTokens += usage.tokens!
        if (validCost) this.usedCostUsd += usage.costUsd!
        return {
          unavailable: this.unavailable,
          exceeded: (limits.maxAggregateTokens !== undefined && this.usedTokens > limits.maxAggregateTokens)
            || (limits.maxAggregateCostUsd !== undefined && this.usedCostUsd > limits.maxAggregateCostUsd),
          exhausted: (limits.maxAggregateTokens !== undefined && this.usedTokens >= limits.maxAggregateTokens)
            || (limits.maxAggregateCostUsd !== undefined && this.usedCostUsd >= limits.maxAggregateCostUsd),
        }
      },
      release: () => {
        if (isReleased) return
        isReleased = true
        release()
      },
    }
  }
}
