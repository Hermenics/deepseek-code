import type { TaskRecordV1, TaskResultEnvelopeV1, TaskRunner } from './types.js'

export interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

export interface TaskSlot<T = unknown> {
  record: TaskRecordV1<T>
  runner: TaskRunner<T>
  controller?: AbortController
  completion: Deferred<TaskResultEnvelopeV1<T>>
  partial?: unknown
  settledAttempt?: number
  inFlight?: boolean
}
