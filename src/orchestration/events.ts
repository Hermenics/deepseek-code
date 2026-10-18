import { randomUUID } from 'node:crypto'
import { mkdir, open } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { TaskEventType, TaskEventV1 } from './types.js'

function isSecretField(field: string): boolean {
  const normalized = field.toLowerCase().replace(/[^a-z0-9]/g, '')
  return /(?:apikey|authorization|cookie|credentials?|password|passwd|privatekey|secret)/.test(normalized)
    || /(?:access|auth|refresh|session)?token$/.test(normalized)
}

/** Redact assignment values in one forward scan, including nested JSON in malformed text. */
function redactAssignments(input: string, hide: (secret: string) => string): string {
  let output = ''
  let copiedThrough = 0
  let index = 0
  while (index < input.length) {
    const quoted = input[index] === '"' || input[index] === "'"
    const keyStart = quoted ? index + 1 : index
    if (!/[A-Za-z_]/.test(input[keyStart] ?? '') || (index > 0 && /[A-Za-z0-9_.-]/.test(input[index - 1]!))) {
      index++
      continue
    }
    let keyEnd = keyStart + 1
    while (keyEnd < input.length && /[A-Za-z0-9_.-]/.test(input[keyEnd]!)) keyEnd++
    const quote = quoted ? input[index] : ''
    if (quote && input[keyEnd] !== quote) { index++; continue }
    let valueStart = quote ? keyEnd + 1 : keyEnd
    while (/\s/.test(input[valueStart] ?? '')) valueStart++
    if (input[valueStart] !== ':' && input[valueStart] !== '=') { index = keyEnd; continue }
    valueStart++
    while (/\s/.test(input[valueStart] ?? '')) valueStart++
    if (!isSecretField(input.slice(keyStart, keyEnd))) { index = keyEnd; continue }

    const valueQuote = input[valueStart] === '"' || input[valueStart] === "'" ? input[valueStart] : ''
    let valueEnd = valueStart
    if (valueQuote) {
      valueEnd++
      while (valueEnd < input.length) {
        if (input[valueEnd] === '\\') { valueEnd += 2; continue }
        if (input[valueEnd] === valueQuote) { valueEnd++; break }
        valueEnd++
      }
    } else {
      while (valueEnd < input.length && !/[\s,;}"']/.test(input[valueEnd]!)) valueEnd++
    }
    output += input.slice(copiedThrough, valueStart)
    valueEnd = Math.min(valueEnd, input.length)
    const closingQuote = valueQuote && valueEnd > valueStart + 1 && input[valueEnd - 1] === valueQuote ? valueQuote : ''
    output += valueQuote + hide(input.slice(valueStart + (valueQuote ? 1 : 0), valueEnd - (closingQuote ? 1 : 0))) + closingQuote
    copiedThrough = valueEnd
    index = valueEnd
  }
  return copiedThrough ? output + input.slice(copiedThrough) : input
}

function redactString(value: string, hide: (secret: string, marker?: string) => string): string {
  const normalized = value
    .replace(/(bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, (match, prefix: string) => prefix + hide(match.slice(prefix.length)))
    .replace(/-----BEGIN [^-\n]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-\n]*PRIVATE KEY-----|$)/g, match => hide(match, '[REDACTED PRIVATE KEY]'))
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/g, match => hide(match))
    .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, match => hide(match))
    .replace(/(:\/\/)[^/\s?#@:]*:[^/\s?#]*@/g, (match, prefix: string) => prefix + hide(match.slice(prefix.length, -1)) + '@')
    .replace(/((?:api[_-]?key|password|secret|token|credential)\s*[=:]\s*)[^\s,;"']+/gi, (match, prefix: string) => prefix + hide(match.slice(prefix.length)))
  return redactAssignments(normalized, hide)
}

/** Mask known secret patterns while preserving UTF-16 offsets and line boundaries for log provenance. */
export function maskSecretsForOffsets(value: string): string {
  return redactString(value, secret => secret.replace(/[^\r\n]/g, '*'))
}

/** Deep-copy a value, replacing secret-looking keys and string patterns (private keys, GitHub/AWS/`sk-` tokens, URL passwords, bearer headers, `key=value` credentials) with redaction markers. */
export function redactSecrets(value: unknown, key = ''): unknown {
  if (isSecretField(key)) return '[REDACTED]'
  if (Array.isArray(value)) return value.map(item => redactSecrets(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, redactSecrets(child, childKey)]))
  }
  if (typeof value === 'string') {
    // Persisted snapshots can contain JSON strings whose escaped quotes are data, not assignment delimiters.
    if (/^\s*[\[{]/.test(value)) {
      let structured: unknown
      try { structured = JSON.parse(value) } catch { /* Malformed historical text still needs textual redaction. */ }
      if (structured && typeof structured === 'object') {
        const sanitized = JSON.stringify(redactSecrets(structured))
        return sanitized === JSON.stringify(structured) ? value : sanitized
      }
    }
    return redactString(value, (_secret, marker = '[REDACTED]') => marker)
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
        const file = await open(this.logFile!, 'a', 0o600)
        try {
          await file.chmod(0o600)
          await file.writeFile(`${JSON.stringify(event)}\n`, 'utf8')
        } finally {
          await file.close()
        }
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
