import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { onExit } from 'signal-exit'
import { scrubbedEnv } from '../utils/platform.js'

/** One entry of a `launch.json` (the `.claude/launch.json` format), resolved against the project root. */
export interface LaunchConfig {
  name: string
  runtimeExecutable: string
  runtimeArgs: string[]
  port: number
  cwd: string
  env: Record<string, string>
  /** Project-relative path of the file it came from. */
  source: string
}

export const LAUNCH_FILES = ['.deepseek/launch.json', '.claude/launch.json']
const LOG_LINES = 500
const READY_TIMEOUT_MS = 60_000

function inside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Validates one configuration; returns an error string for anything malformed (never guesses). */
function parseConfig(raw: unknown, root: string, source: string): LaunchConfig | string {
  if (!raw || typeof raw !== 'object') return 'a configuration is not an object'
  const c = raw as Record<string, unknown>
  const name = typeof c.name === 'string' && c.name.trim() ? c.name.trim() : null
  if (!name) return 'a configuration has no name'
  if (typeof c.runtimeExecutable !== 'string' || !c.runtimeExecutable.trim()) return `${name}: runtimeExecutable must be a command`
  const args = c.runtimeArgs ?? []
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) return `${name}: runtimeArgs must be a list of strings`
  if (!Number.isInteger(c.port) || (c.port as number) < 1 || (c.port as number) > 65535) return `${name}: port must be 1-65535`
  const cwd = resolve(root, typeof c.cwd === 'string' ? c.cwd : '.')
  if (!inside(root, cwd)) return `${name}: cwd must stay inside the project`
  const env = c.env ?? {}
  if (typeof env !== 'object' || Array.isArray(env) || Object.values(env as object).some(v => typeof v !== 'string')) return `${name}: env values must be strings`
  return { name, runtimeExecutable: c.runtimeExecutable.trim(), runtimeArgs: args as string[], port: c.port as number, cwd, env: env as Record<string, string>, source }
}

/** Reads the first launch file present (`.deepseek/` wins over `.claude/`). */
export async function readLaunchConfigs(root: string): Promise<{ configs: LaunchConfig[]; source?: string; error?: string }> {
  for (const source of LAUNCH_FILES) {
    let text: string
    try { text = await readFile(join(root, source), 'utf8') } catch { continue }
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch (error) { return { configs: [], source, error: `${source} is not valid JSON: ${(error as Error).message}` } }
    const list = (parsed as { configurations?: unknown })?.configurations
    if (!Array.isArray(list)) return { configs: [], source, error: `${source} has no "configurations" list` }
    const configs: LaunchConfig[] = []
    for (const raw of list) {
      const config = parseConfig(raw, root, source)
      if (typeof config === 'string') return { configs: [], source, error: `${source}: ${config}` }
      configs.push(config)
    }
    return { configs, source }
  }
  return { configs: [] }
}

/** What an approval covers: the exact command, directory, env and port. Any edit to the entry changes it. */
export function launchHash(config: LaunchConfig): string {
  const { name, runtimeExecutable, runtimeArgs, port, cwd, env } = config
  return createHash('sha256').update(JSON.stringify([name, runtimeExecutable, runtimeArgs, port, cwd, Object.entries(env).sort()])).digest('hex').slice(0, 16)
}

/** The command line as the user sees it in the approval prompt. */
export function launchCommand(config: LaunchConfig): string {
  const quote = (part: string) => /^[\w@%+=:,./-]+$/.test(part) ? part : `'${part.replace(/'/g, `'\\''`)}'`
  const env = Object.entries(config.env).map(([key, value]) => `${key}=${quote(value)}`)
  return [...env, config.runtimeExecutable, ...config.runtimeArgs].map((part, i) => i < env.length ? part : quote(part)).join(' ')
}

/** Resolves when something accepts TCP connections on the port. */
export function portOpen(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise(done => {
    const socket = connect({ port, host })
    const finish = (open: boolean) => { socket.destroy(); done(open) }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(500, () => finish(false))
  })
}

interface RunningServer {
  config: LaunchConfig
  root: string
  owner: string
  proc: ReturnType<typeof Bun.spawn>
  logs: string[]
  exitCode: number | null
  startedAt: number
}

/** Dev servers started by the agent. They run on the host (outside the shell sandbox), each in its own process group. */
export class DevServerManager {
  private servers = new Map<string, RunningServer>()
  private removeExitHook: (() => void) | null = null

  private key(root: string, name: string): string {
    return `${root}\0${name}`
  }

  get(root: string, name: string): RunningServer | undefined {
    return this.servers.get(this.key(root, name))
  }

  list(root: string): RunningServer[] {
    return [...this.servers.values()].filter(server => server.root === root)
  }

  async start(root: string, config: LaunchConfig, owner: string, signal?: AbortSignal): Promise<string> {
    const running = this.get(root, config.name)
    if (running && running.exitCode === null) return `${config.name} is already running (pid ${running.proc.pid}) at http://localhost:${config.port}`
    const url = `http://localhost:${config.port}`
    if (await portOpen(config.port)) return `Port ${config.port} is already in use (perhaps the user started ${config.name} already); did not start another. Use ${url}.`

    let proc: ReturnType<typeof Bun.spawn>
    try {
      // The project's own variables stay out: only the safe base env plus what launch.json declares.
      proc = Bun.spawn([config.runtimeExecutable, ...config.runtimeArgs], {
        cwd: config.cwd,
        env: { ...scrubbedEnv(), ...config.env },
        stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
        detached: true,
      })
    } catch (error) {
      return `Error: could not start ${config.name}: ${(error as Error).message}`
    }
    const server: RunningServer = { config, root, owner, proc, logs: [], exitCode: null, startedAt: Date.now() }
    this.servers.set(this.key(root, config.name), server)
    this.removeExitHook ??= onExit(() => this.killAll())
    void this.pump(server, proc.stdout as ReadableStream<Uint8Array>, '')
    void this.pump(server, proc.stderr as ReadableStream<Uint8Array>, '[err] ')
    void proc.exited.then(code => { server.exitCode = code })

    const deadline = Date.now() + READY_TIMEOUT_MS
    while (Date.now() < deadline && server.exitCode === null && !signal?.aborted) {
      if (await portOpen(config.port)) return `Started ${config.name} (pid ${proc.pid}); ready at ${url} after ${((Date.now() - server.startedAt) / 1000).toFixed(1)}s.`
      await Bun.sleep(250)
    }
    if (server.exitCode !== null) return `Error: ${config.name} exited with code ${server.exitCode} before listening on port ${config.port}.\n${this.tail(server, 30)}`
    if (signal?.aborted) return `Cancelled: ${config.name} is still starting (pid ${proc.pid}); check it with dev_server logs.`
    return `${config.name} is running (pid ${proc.pid}) but nothing listens on port ${config.port} after ${READY_TIMEOUT_MS / 1000}s. Check the port in ${config.source}.\n${this.tail(server, 30)}`
  }

  private async pump(server: RunningServer, stream: ReadableStream<Uint8Array>, prefix: string): Promise<void> {
    const decoder = new TextDecoder()
    let partial = ''
    const reader = stream.getReader()
    try {
      for (let read = await reader.read(); !read.done; read = await reader.read()) {
        const chunk = read.value
        const lines = (partial + decoder.decode(chunk, { stream: true })).split(/\r?\n/)
        partial = lines.pop() ?? ''
        for (const line of lines) this.push(server, prefix + line)
      }
    } catch { /* the process went away */ }
    if (partial) this.push(server, prefix + partial)
  }

  private push(server: RunningServer, line: string): void {
    // Strip ANSI colors: they cost tokens and carry nothing for the model.
    server.logs.push(line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''))
    if (server.logs.length > LOG_LINES) server.logs.splice(0, server.logs.length - LOG_LINES)
  }

  tail(server: RunningServer, lines: number, filter?: string): string {
    const needle = filter?.toLowerCase()
    const selected = (needle ? server.logs.filter(line => line.toLowerCase().includes(needle)) : server.logs).slice(-lines)
    return selected.length ? selected.join('\n') : '(no output)'
  }

  /** SIGTERM to the whole process group (npm → vite → esbuild), SIGKILL if it lingers. */
  async stop(root: string, name: string): Promise<boolean> {
    const server = this.get(root, name)
    if (!server) return false
    if (server.exitCode !== null) {
      this.servers.delete(this.key(root, name))
      return true
    }
    this.signal(server, 'SIGTERM')
    const exited = await Promise.race([server.proc.exited.then(() => true), Bun.sleep(3000).then(() => false)])
    if (!exited) this.signal(server, 'SIGKILL')
    if (this.get(root, name) === server) this.servers.delete(this.key(root, name))
    return true
  }

  private signal(server: RunningServer, signal: NodeJS.Signals): void {
    try { process.kill(-server.proc.pid, signal) } catch {
      try { server.proc.kill(signal) } catch { /* already gone */ }
    }
  }

  /** Stops what a session started (when it ends or changes project). */
  async stopOwnedBy(owner: string): Promise<void> {
    await Promise.all([...this.servers.values()].filter(server => server.owner === owner).map(server => this.stop(server.root, server.config.name)))
  }

  /** Synchronous last resort on process exit. */
  killAll(): void {
    for (const server of this.servers.values()) if (server.exitCode === null) this.signal(server, 'SIGKILL')
    this.servers.clear()
  }
}

export const devServers = new DevServerManager()
