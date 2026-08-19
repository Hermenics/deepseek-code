import type { ServerEvent } from './protocol.js'
import { isWindows } from '../utils/platform.js'

type EventSink = (event: ServerEvent) => void

/**
 * One persistent, real PTY per web session. Bun gives us a native PTY here,
 * so shells, prompts, Ctrl+C, and line-oriented REPLs behave like an IDE
 * terminal instead of a one-command HTTP approximation.
 */
export class WebTerminal {
  private static readonly MAX_TRANSCRIPT = 64 * 1024
  private static readonly FLUSH_DELAY_MS = 12
  private static readonly FLUSH_MAX_BUFFER = 32_768
  private terminal: Bun.Terminal | null = null
  private process: { kill(signal?: number | string): void; exited: Promise<number> } | null = null
  private decoder = new TextDecoder()
  private transcript = ''
  private pendingOutput = ''
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly cwd: string, private readonly send: EventSink) {}

  open(cols = 100, rows = 28): void {
    if (this.terminal && !this.terminal.closed) {
      this.resize(cols, rows)
      return
    }

    this.decoder = new TextDecoder()
    this.terminal = new Bun.Terminal({
      cols,
      rows,
      name: 'xterm-256color',
      data: (_terminal, data) => this.emit(this.decoder.decode(data, { stream: true })),
    })
    const terminal = this.terminal
    const shell = isWindows ? (process.env.COMSPEC || 'cmd.exe') : (process.env.SHELL || '/bin/bash')
    const shellArgs = isWindows ? [] : ['--noprofile', '--norc']
    this.process = Bun.spawn([shell, ...shellArgs], {
      cwd: this.cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        ...(isWindows ? {} : { PS1: '\\[\\e[38;5;80m\\]deepseek\\[\\e[0m\\]:\\[\\e[38;5;110m\\]\\W\\[\\e[0m\\] \\$ ' }),
      },
      terminal,
    })
    void this.process.exited.then((code) => {
      if (this.terminal === terminal) {
        const remaining = this.decoder.decode()
        if (remaining) this.emit(remaining)
        // Deliver everything the shell printed before announcing its exit.
        this.flush()
        this.send({ type: 'terminal_exit', code })
        this.terminal = null
        this.process = null
      }
    })
  }

  input(data: string): void {
    if (!this.terminal || this.terminal.closed) return
    this.terminal.write(data)
  }

  resize(cols: number, rows: number): void {
    if (!this.terminal || this.terminal.closed) return
    this.terminal.resize(cols, rows)
  }

  reset(cols: number, rows: number): void {
    this.stop()
    this.transcript = ''
    this.pendingOutput = ''
    this.open(cols, rows)
  }

  snapshot(): string { return this.transcript }

  stop(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.flush()
    this.process?.kill('SIGTERM')
    this.terminal?.close()
    this.process = null
    this.terminal = null
  }

  /**
   * The PTY emits many tiny chunks under load (compilers, cat, --watch builds).
   * Coalescing them into one frame every few milliseconds keeps the websocket
   * and the browser JSON parser from becoming the bottleneck.
   */
  private emit(data: string): void {
    if (!data) return
    this.transcript = (this.transcript + data).slice(-WebTerminal.MAX_TRANSCRIPT)
    this.pendingOutput += data
    if (this.pendingOutput.length >= WebTerminal.FLUSH_MAX_BUFFER) {
      this.flush()
      return
    }
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null
        this.flush()
      }, WebTerminal.FLUSH_DELAY_MS)
    }
  }

  private flush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    const data = this.pendingOutput
    if (!data) return
    this.pendingOutput = ''
    this.send({ type: 'terminal_data', data })
  }
}
