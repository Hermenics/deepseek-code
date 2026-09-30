/**
 * Chrome DevTools Protocol connection. Chrome speaks it over `--remote-debugging-pipe`: JSON
 * messages terminated by a NUL byte, written to fd 3 and read from fd 4 — no TCP port, so no
 * other local process can attach to the browser.
 */

/** Raw message channel under a CDP connection; the pipe in production, an in-memory fake in tests. */
export interface CdpTransport {
  send(message: string): void
  /** Registers the message and close handlers; called once. */
  start(onMessage: (message: string) => void, onClose: (reason: string) => void): void
  close(): void
}

export type CdpListener = (params: Record<string, unknown>, sessionId: string | undefined) => void

interface Pending {
  resolve: (result: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** Default time a single CDP command may take before it is rejected. */
export const CDP_COMMAND_TIMEOUT_MS = 10_000

/** Error raised for a CDP command that failed, timed out or was cut off by the connection closing. */
export class CdpError extends Error {}

/** Request/response correlation by id, event dispatch by method (and session), and fail-fast on close. */
export class CdpConnection {
  private nextId = 0
  private readonly pending = new Map<number, Pending>()
  private readonly listeners = new Map<string, Set<CdpListener>>()
  private closedReason: string | null = null

  constructor(private readonly transport: CdpTransport) {
    transport.start(message => this.receive(message), reason => this.fail(reason))
  }

  /** Why the connection closed, or null while it is open. */
  get closed(): string | null {
    return this.closedReason
  }

  /** Sends a command (to a flattened target session when `sessionId` is given) and resolves with its result. */
  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = CDP_COMMAND_TIMEOUT_MS): Promise<T> {
    if (this.closedReason) return Promise.reject(new CdpError(`Browser connection closed: ${this.closedReason}`))
    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new CdpError(`${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as Pending['resolve'], reject, timer })
      try {
        this.transport.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new CdpError(`${method} could not be sent: ${(error as Error).message}`))
      }
    })
  }

  /** Subscribes to an event (all sessions); returns the unsubscribe function. */
  on(method: string, listener: CdpListener): () => void {
    const set = this.listeners.get(method) ?? new Set()
    set.add(listener)
    this.listeners.set(method, set)
    return () => { set.delete(listener) }
  }

  /** Closes the transport and rejects every pending command. */
  close(reason = 'closed'): void {
    if (this.closedReason) return
    try { this.transport.close() } catch { /* already gone */ }
    this.fail(reason)
  }

  private receive(raw: string): void {
    let message: { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message?: string }; sessionId?: string }
    try {
      message = JSON.parse(raw)
    } catch {
      return // A malformed frame is dropped; the command it answered times out.
    }
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error) pending.reject(new CdpError(message.error.message ?? 'CDP error'))
      else pending.resolve(message.result ?? {})
      return
    }
    if (!message.method) return
    for (const listener of this.listeners.get(message.method) ?? []) {
      try { listener(message.params ?? {}, message.sessionId) } catch { /* a listener bug must not break dispatch */ }
    }
  }

  private fail(reason: string): void {
    if (this.closedReason) return
    this.closedReason = reason
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new CdpError(`Browser connection closed: ${reason}`))
      this.pending.delete(id)
    }
  }
}

/**
 * Transport over Chrome's debugging pipe. Frames are split on the NUL byte before decoding, so a
 * multi-byte UTF-8 character cut between two chunks is reassembled intact.
 */
export function pipeTransport(writeFd: number, readFd: number): CdpTransport {
  const writer = Bun.file(writeFd).writer()
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  return {
    send(message) {
      writer.write(`${message}\0`)
      void writer.flush()
    },
    start(onMessage, onClose) {
      reader = Bun.file(readFd).stream().getReader()
      let buffer = Buffer.alloc(0)
      void (async () => {
        try {
          for (;;) {
            const { value, done } = await reader!.read()
            if (done) break
            buffer = Buffer.concat([buffer, Buffer.from(value)])
            let end: number
            while ((end = buffer.indexOf(0)) >= 0) {
              onMessage(buffer.subarray(0, end).toString('utf8'))
              buffer = buffer.subarray(end + 1)
            }
          }
          onClose('browser pipe ended')
        } catch (error) {
          onClose(`browser pipe failed: ${(error as Error).message}`)
        }
      })()
    },
    close() {
      void reader?.cancel().catch(() => {})
      void Promise.resolve(writer.end()).catch(() => {})
    },
  }
}
