import { randomUUID } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { TaskEventType, TaskEventV1 } from './types.js'

const SECRET_KEY = /(api[_-]?key|authorization|cookie|credential|password|private[_-]?key|secret|(?:^|[_-])(?:access|auth|refresh|session)?token$)/i

/** Deep-copy a value, replacing values under secret-looking keys and secret patterns inside strings (private keys, GitHub/AWS/`sk-` tokens, bearer headers, `key=value` credentials) with redaction markers. */
export function redactSecrets(value: unknown, key = ''): unknown {
  if (SECRET_KEY.test(key)) return '[REDACTED]'
  if (Array.isArray(value)) return value.map(item => redactSecrets(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, redactSecrets(child, childKey)]))
  }
  if (typeof value === 'string') {
    return value
      .replace(/-----BEGIN [^-\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\n]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
      .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/g, '[REDACTED]')
      .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, '[REDACTED]')
      .replace(/(bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[REDACTED]')
      .replace(/((?:api[_-]?key|password|secret|token|credential)\s*[=:]\s*)[^\s,;"']+/gi, '$1[REDACTED]')
  }
  return value
}

export type TaskEventListener = (event: TaskEventV1) => void

/** Session event log: keeps events in memory, fans them out to subscribers and optionally appends them as JSONL to a log file. */
export class TaskEventSink {
  private readonly listeners = new Set<TaskEventListener>()
  private readonly memory: TaskEventV1[] = []
  private writeChain = Promise.resolve()
  private writeError?: Error

  constructor(readonly sessionId: string, private readonly logFile?: string) {}

  /** Create a redacted event, record it, notify listeners (their errors are swallowed) and queue the log-file append. Returns the event. */
  emit(type: TaskEventType, payload: Record<string, unknown>, taskId?: string, parentTaskId?: string, correlationId: string = randomUUID()): TaskEventV1 {
    const event: TaskEventV1 = {
      schemaVersion: 1,
      eventId: randomUUID(),
      sessionId: this.sessionId,
      taskId,
      parentTaskId,
      correlationId,
      type,
      timestamp: new Date().toISOString(),
      payload: redactSecrets(payload) as Record<string, unknown>,
    }
    this.memory.push(event)
    for (const listener of this.listeners) {
      try { listener(structuredClone(event)) } catch { /* observers cannot break task execution */ }
    }
    if (this.logFile) {
      this.writeChain = this.writeChain.then(async () => {
        await mkdir(dirname(this.logFile!), { recursive: true })
        await appendFile(this.logFile!, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 })
      }).catch(error => { this.writeError = error instanceof Error ? error : new Error(String(error)) })
    }
    return event
  }

  subscribe(listener: TaskEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Return cloned copies of recorded events, optionally only those of one task. */
  list(taskId?: string): TaskEventV1[] {
    return this.memory.filter(event => !taskId || event.taskId === taskId).map(event => structuredClone(event))
  }

  /** Wait for pending log appends and rethrow the last write failure, if any. */
  async flush(): Promise<void> {
    await this.writeChain
    if (this.writeError) throw this.writeError
  }
}
