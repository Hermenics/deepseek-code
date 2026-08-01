import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import type { Store } from '../store/store.js'
import type { EventBus } from '../events/eventBus.js'

export type HookHandlerType = 'command' | 'shell' | 'http' | 'prompt' | 'agent'

export interface HookDefinition {
  id: string; event: string; matcher?: string; handler_type: HookHandlerType
  handler_config: Record<string, unknown>
  scope: 'system' | 'user' | 'project' | 'local' | 'plugin'
  timeout_ms: number; enabled: boolean; content_hash?: string
}

export type HookDecision = 'observe' | 'allow' | 'block' | 'ask' | 'modify' | 'continue' | 'stop'

const VALID_DECISIONS = new Set<HookDecision>(['observe', 'allow', 'block', 'ask', 'modify', 'continue', 'stop'])

export interface HookDecisionResult {
  decision: HookDecision; reason?: string; modified_input?: Record<string, unknown>
}

export interface HookRunResult {
  run_id: string; hook_id: string; event: string; decision: HookDecision | null
  error: string | null; duration_ms: number; started_at: string; finished_at: string
}

export interface HookExecContext {
  session_id: string; cwd: string; event: string; tool_name?: string; tool_input?: Record<string, unknown>
}

export type HookHandler = (def: HookDefinition, ctx: HookExecContext) => Promise<HookDecisionResult>

export const MAX_HOOK_RUNTIME_RUNS = 500

// ── Default handlers ────────────────────────────────────────────────

function parseDecisionOutput(text: string): HookDecisionResult {
  try {
    const parsed = JSON.parse(text) as HookDecisionResult
    if (parsed.decision && !VALID_DECISIONS.has(parsed.decision as HookDecision)) {
      return { decision: 'allow' }
    }
    return parsed
  } catch {
    return { decision: 'allow' }
  }
}

function runProcessHandler(useShell: boolean): HookHandler {
  return async (def, ctx) => {
    const config = def.handler_config as { command?: string; argv?: string[] }
    const command = config.command ?? ''
    const timeoutMs = def.timeout_ms || 30_000

    // Shell: ['sh', '-c', command]. Command: require config.argv; never split.
    const argv = useShell
      ? ['-c', command]
      : (config.argv ?? [command])

    const stdout = await new Promise<string>((resolve, reject) => {
      const proc = useShell
        ? spawn('sh', argv, { cwd: ctx.cwd, stdio: ['pipe', 'pipe', 'pipe'] })
        : spawn(argv[0] ?? '', argv.slice(1), { cwd: ctx.cwd, stdio: ['pipe', 'pipe', 'pipe'] })

      const MAX_BYTES = 100_000
      let out = ''; let err = ''
      let finalized = false
      let killedByTimeout = false

      const timer = setTimeout(() => { killedByTimeout = true; proc.kill('SIGKILL') }, timeoutMs)

      function finish(reason?: string): void {
        if (finalized) return
        finalized = true; clearTimeout(timer)
        if (reason) reject(new Error(reason))
        else resolve(out.trim())
      }

      function append(buf: string, chunk: Buffer): string {
        if (buf.length >= MAX_BYTES) return buf
        return buf + chunk.toString('utf8', 0, Math.min(chunk.length, MAX_BYTES - buf.length))
      }

      proc.stdout?.on('data', (c: Buffer) => { out = append(out, c) })
      proc.stderr?.on('data', (c: Buffer) => { err = append(err, c) })

      proc.stdin?.on('error', (e: Error) => finish(`stdin error: ${e.message}`))

      proc.on('error', (e: Error) => finish(e.message))
      proc.on('close', (code, signal) => {
        if (killedByTimeout || (code === null && signal === 'SIGKILL')) { finish('Hook timed out'); return }
        if (code !== 0) { finish(err.trim() || `exited with code ${code}`); return }
        finish()
      })

      try { proc.stdin?.write(JSON.stringify({ schema_version: 1, event: ctx.event, session_id: ctx.session_id, cwd: ctx.cwd, tool_name: ctx.tool_name, tool_input: ctx.tool_input })); proc.stdin?.end() } catch {}
    })

    return parseDecisionOutput(stdout)
  }
}

const runHttpHandler: HookHandler = async (def, ctx) => {
  const config = def.handler_config as { url?: string; method?: string; headers?: Record<string, string> }
  if (!config.url) return { decision: 'block', reason: 'http handler requires a url' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), def.timeout_ms || 30_000)
  try {
    const response = await fetch(config.url, {
      method: config.method ?? 'POST',
      headers: { 'content-type': 'application/json', ...(config.headers ?? {}) },
      body: JSON.stringify({ session_id: ctx.session_id, cwd: ctx.cwd, event: ctx.event, tool_name: ctx.tool_name }),
      signal: controller.signal,
    })
    // Non-OK → blocked, matching transport-error behavior.
    const text = await (async () => {
      const reader = response.body?.getReader()
      if (!reader) return ''
      let result = ''; const limit = 100_000
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (result.length < limit) {
          result += new TextDecoder().decode(value.slice(0, limit - result.length), { stream: true })
        }
      }
      return result.length > limit ? result.slice(0, limit) : result
    })()
    if (!response.ok) return { decision: 'block', reason: `HTTP ${response.status}: ${text.slice(0, 200)}` }
    return parseDecisionOutput(text)
  } catch (e) {
    return { decision: 'block', reason: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timer)
  }
}

// ── Hook Runtime ────────────────────────────────────────────────────

export class HookRuntime {
  private readonly definitions = new Map<string, HookDefinition>()
  private readonly trustStore = new Map<string, string>()
  private readonly runs: HookRunResult[] = []
  private readonly handlers = new Map<HookHandlerType, HookHandler>()

  constructor(private readonly store: Store, private readonly events: EventBus) {
    this.handlers.set('command', runProcessHandler(false))
    this.handlers.set('shell', runProcessHandler(true))
    this.handlers.set('http', runHttpHandler)
  }

  registerHandler(type: HookHandlerType, handler: HookHandler): void { this.handlers.set(type, handler) }
  register(def: HookDefinition): void { def.content_hash = this.computeHash(def); this.definitions.set(def.id, def); this.events.emit('HookRegistered', { hook_id: def.id, event: def.event, scope: def.scope }, {}) }
  trust(hookId: string): boolean { const d = this.definitions.get(hookId); if (!d?.content_hash) return false; this.trustStore.set(hookId, d.content_hash); this.events.emit('HookTrusted', { hook_id: hookId, hash: d.content_hash }, {}); return true }
  isTrusted(hookId: string): boolean { const d = this.definitions.get(hookId); const t = this.trustStore.get(hookId); return !!(d && t && d.content_hash === t) }

  getMatching(event: string, toolName?: string): HookDefinition[] {
    const m: HookDefinition[] = []
    for (const d of this.definitions.values()) {
      if (!d.enabled) continue
      if (d.event !== event && d.event !== '*') continue
      if (d.matcher && toolName && !matchesPattern(d.matcher, toolName)) continue
      if ((d.scope === 'project' || d.scope === 'local') && !this.isTrusted(d.id)) continue
      m.push(d)
    }
    return m
  }

  async execute(event: string, toolName: string | undefined, toolInput: Record<string, unknown> | undefined, context: { session_id: string; cwd: string }): Promise<{ decision: HookDecision; modifiedInput?: Record<string, unknown>; runs: HookRunResult[] }> {
    const hooks = this.getMatching(event, toolName)
    const results: HookRunResult[] = []
    let currentInput = toolInput

    for (const hook of hooks) {
      const started = Date.now(); const runId = randomUUID()
      let decision: HookDecision | null = null; let error: string | null = null; let mod: Record<string, unknown> | undefined

      const handler = this.handlers.get(hook.handler_type)
      if (!handler) { error = `No handler registered for handler_type '${hook.handler_type}'`; decision = 'block' }
      else {
        try {
          // Pass currentInput so chained hooks see prior modifications.
          const outcome = await handler(hook, { session_id: context.session_id, cwd: context.cwd, event, tool_name: toolName, tool_input: currentInput })
          decision = outcome.decision; mod = outcome.modified_input
          if (outcome.reason && outcome.decision === 'block') error = outcome.reason
        } catch (err) { error = err instanceof Error ? err.message : String(err); decision = 'block' }
      }

      const final: HookDecision = decision ?? 'allow'; if (mod) currentInput = mod
      const result: HookRunResult = { run_id: runId, hook_id: hook.id, event, decision: final, error, duration_ms: Date.now() - started, started_at: new Date(started).toISOString(), finished_at: new Date().toISOString() }
      results.push(result); this.pushRun(result)

      this.store.run(`INSERT INTO hook_runs (run_id, hook_id, event, command, scope, decision, exit_code, error, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, runId, hook.id, event, JSON.stringify(hook.handler_config), hook.scope, final, error ? 1 : 0, error, result.started_at, result.finished_at)

      if (final === 'block' || final === 'stop') {
        // Return accumulated currentInput, not just the final hook's mod.
        return { decision: final, modifiedInput: currentInput !== toolInput ? currentInput : undefined, runs: results }
      }
    }

    return { decision: 'allow', modifiedInput: currentInput !== toolInput ? currentInput : undefined, runs: results }
  }

  getRuns(filter?: { hook_id?: string; event?: string; limit?: number }): HookRunResult[] {
    let r = this.runs; if (filter?.hook_id) r = r.filter(x => x.hook_id === filter.hook_id); if (filter?.event) r = r.filter(x => x.event === filter.event); return r.slice(-(filter?.limit ?? 50))
  }

  checkTrustInvalidation(): Array<{ hook_id: string; trusted_hash: string; current_hash: string }> { const inv: Array<{ hook_id: string; trusted_hash: string; current_hash: string }> = []; for (const [id, t] of this.trustStore) { const d = this.definitions.get(id); if (d?.content_hash && d.content_hash !== t) inv.push({ hook_id: id, trusted_hash: t, current_hash: d.content_hash }) }; return inv }

  private pushRun(r: HookRunResult): void { this.runs.push(r); if (this.runs.length > MAX_HOOK_RUNTIME_RUNS) this.runs.splice(0, this.runs.length - MAX_HOOK_RUNTIME_RUNS) }
  private computeHash(def: HookDefinition): string { return createHash('sha256').update(JSON.stringify({ event: def.event, matcher: def.matcher, handler_type: def.handler_type, handler_config: def.handler_config, timeout_ms: def.timeout_ms })).digest('hex').slice(0, 32) }
}

function matchesPattern(pattern: string, toolName: string): boolean { return !pattern || pattern === '*' || pattern.split('|').map(p => p.trim().toLowerCase()).includes(toolName.toLowerCase()) }
