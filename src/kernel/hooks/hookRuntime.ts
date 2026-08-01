import { createHash, randomUUID } from 'node:crypto'
import type { Store } from '../store/store.js'
import type { EventBus } from '../events/eventBus.js'

// ── Hook Types ──────────────────────────────────────────────────────

export type HookHandlerType = 'command' | 'shell' | 'http' | 'prompt' | 'agent'

export interface HookDefinition {
  id: string
  event: string
  matcher?: string
  handler_type: HookHandlerType
  handler_config: Record<string, unknown>
  scope: 'system' | 'user' | 'project' | 'local' | 'plugin'
  timeout_ms: number
  enabled: boolean
  content_hash?: string
}

export type HookDecision = 'observe' | 'allow' | 'block' | 'ask' | 'modify' | 'continue' | 'stop'

export interface HookDecisionResult {
  decision: HookDecision
  reason?: string
  modified_input?: Record<string, unknown>
}

export interface HookRunResult {
  run_id: string
  hook_id: string
  event: string
  decision: HookDecision | null
  error: string | null
  duration_ms: number
  started_at: string
  finished_at: string
}

// ── Hook Runtime ────────────────────────────────────────────────────

export class HookRuntime {
  private readonly definitions = new Map<string, HookDefinition>()
  private readonly trustStore = new Map<string, string>() // hook_id → trusted_hash
  private readonly runs: HookRunResult[] = []

  constructor(
    private readonly store: Store,
    private readonly events: EventBus,
  ) {}

  /** Register a hook definition. */
  register(def: HookDefinition): void {
    def.content_hash = this.computeHash(def)
    this.definitions.set(def.id, def)
    this.events.emit('HookRegistered', { hook_id: def.id, event: def.event, scope: def.scope }, {})
  }

  /** Trust a hook by its content hash. */
  trust(hookId: string): boolean {
    const def = this.definitions.get(hookId)
    if (!def?.content_hash) return false
    this.trustStore.set(hookId, def.content_hash)
    this.events.emit('HookTrusted', { hook_id: hookId, hash: def.content_hash }, {})
    return true
  }

  /** Check if a hook's current content matches the trusted hash. */
  isTrusted(hookId: string): boolean {
    const def = this.definitions.get(hookId)
    const trusted = this.trustStore.get(hookId)
    if (!def || !trusted) return false
    return def.content_hash === trusted
  }

  /** Get hooks matching an event and optional matcher. */
  getMatching(event: string, toolName?: string): HookDefinition[] {
    const matched: HookDefinition[] = []
    for (const def of this.definitions.values()) {
      if (!def.enabled) continue
      if (def.event !== event && def.event !== '*') continue
      if (def.matcher && toolName && !this.matchesPattern(def.matcher, toolName)) continue
      // Project/local hooks must be trusted
      if ((def.scope === 'project' || def.scope === 'local') && !this.isTrusted(def.id)) continue
      matched.push(def)
    }
    return matched
  }

  /** Execute hooks for an event. Returns the first blocking decision, or 'allow'. */
  async execute(
    event: string,
    toolName: string | undefined,
    toolInput: Record<string, unknown> | undefined,
    context: { session_id: string; cwd: string },
  ): Promise<{ decision: HookDecision; modifiedInput?: Record<string, unknown>; runs: HookRunResult[] }> {
    const hooks = this.getMatching(event, toolName)
    const results: HookRunResult[] = []
    let currentInput = toolInput

    for (const hook of hooks) {
      const started = Date.now()
      const runId = randomUUID()
      let decision: HookDecision | null = null
      let error: string | null = null

      try {
        // Simulate hook execution (real impl would spawn process/call HTTP/run prompt)
        // decision stays null for now; actual execution happens in real implementation
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
        decision = 'block'
      }
      const finalDecision: HookDecision = decision ?? 'allow'

      const result: HookRunResult = {
        run_id: runId,
        hook_id: hook.id,
        event,
        decision: finalDecision,
        error,
        duration_ms: Date.now() - started,
        started_at: new Date(started).toISOString(),
        finished_at: new Date().toISOString(),
      }
      results.push(result)
      this.runs.push(result)

      // Persist run
      this.store.run(
        `INSERT INTO hook_runs (run_id, hook_id, event, command, scope, decision, exit_code, error, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        runId, hook.id, event, JSON.stringify(hook.handler_config), hook.scope,
        finalDecision, error ? 1 : 0, error, result.started_at, result.finished_at,
      )

      if (finalDecision === 'block' || (finalDecision as string) === 'stop') {
        return { decision: finalDecision, runs: results }
      }
    }

    return {
      decision: 'allow',
      modifiedInput: currentInput !== toolInput ? currentInput : undefined,
      runs: results,
    }
  }

  /** Get run history for diagnostics. */
  getRuns(filter?: { hook_id?: string; event?: string; limit?: number }): HookRunResult[] {
    let results = this.runs
    if (filter?.hook_id) results = results.filter(r => r.hook_id === filter.hook_id)
    if (filter?.event) results = results.filter(r => r.event === filter.event)
    return results.slice(-(filter?.limit ?? 50))
  }

  /** Check if trust was invalidated (content changed since trust). */
  checkTrustInvalidation(): Array<{ hook_id: string; trusted_hash: string; current_hash: string }> {
    const invalidated: Array<{ hook_id: string; trusted_hash: string; current_hash: string }> = []
    for (const [id, trusted] of this.trustStore) {
      const def = this.definitions.get(id)
      if (def?.content_hash && def.content_hash !== trusted) {
        invalidated.push({ hook_id: id, trusted_hash: trusted, current_hash: def.content_hash })
      }
    }
    return invalidated
  }

  private computeHash(def: HookDefinition): string {
    const canonical = JSON.stringify({
      event: def.event,
      matcher: def.matcher,
      handler_type: def.handler_type,
      handler_config: def.handler_config,
      timeout_ms: def.timeout_ms,
    })
    return createHash('sha256').update(canonical).digest('hex').slice(0, 32)
  }

  private matchesPattern(pattern: string, toolName: string): boolean {
    if (!pattern || pattern === '*') return true
    return pattern.split('|').map(p => p.trim().toLowerCase()).includes(toolName.toLowerCase())
  }
}
