import { randomUUID } from 'node:crypto'
import { mkdir, lstat, readFile, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { ProviderConfig } from '../types/provider.js'
import type { DeepSeekSettings } from '../settings/types.js'
import type { InteractionMode } from '../ui/interactionMode.js'
import { OrchestratorSession, type OrchestratorCallbacks } from '../orchestration/OrchestratorSession.js'
import type { TaskRecordV1 } from '../orchestration/types.js'
import { discoverWorkflows } from './discovery.js'
import { executeWorkflowScript, type WorkflowExecution } from './runtime.js'
import { formatWorkflowSource, isWorkflowName, parseWorkflowSource } from './parser.js'
import { WorkflowApprovalStore, WorkflowStore, hashWorkflowValue, type WorkflowJournal, type WorkflowJournalEntry } from './storage.js'
import type {
  WorkflowAgentOptions, WorkflowEvent, WorkflowFailure, WorkflowResult, WorkflowRpcResult, WorkflowRun, WorkflowRunOptions, WorkflowUsage,
} from './types.js'

const MAX_AGENTS = 17
const MAX_CONCURRENCY = 16
const RUN_ID_INPUT = /^[a-f0-9-]{4,36}$/i

export interface WorkflowAgentRequest {
  prompt: string
  options: WorkflowAgentOptions
  session: OrchestratorSession
  interactionMode: InteractionMode
  signal: AbortSignal
}

export interface WorkflowAgentResponse extends WorkflowRpcResult {
  taskId?: string
  worktree?: string
  error?: string
}

export type WorkflowAgentRunner = (request: WorkflowAgentRequest) => Promise<WorkflowAgentResponse>

export interface WorkflowManagerOptions {
  sessionId: string
  projectRoot: string
  providerConfig: ProviderConfig
  model?: string
  settings?: DeepSeekSettings
  interactionMode?: () => InteractionMode
  baseDirectory?: string
  agentRunner?: WorkflowAgentRunner
  workflowLoader?: (name: string) => Promise<string | undefined>
}

export interface StartWorkflowInput {
  script: string
  name?: string
  args?: unknown
  timeoutMs?: number
  maxTokens?: number
  maxCostUsd?: number
}

export interface WorkflowHandle {
  runId: string
  result: Promise<WorkflowResult>
  cancel(reason?: string): void
}

export interface WorkflowManagerEvent {
  type: 'run' | 'runtime'
  run: WorkflowRun
  event?: WorkflowEvent
}

interface ActiveRun {
  record: WorkflowRun
  script: string
  args: unknown
  store: WorkflowStore
  journal: WorkflowJournal
  replay?: WorkflowJournal
  replayValid: boolean
  nextCall: number
  execution?: WorkflowExecution
  session: OrchestratorSession
  controller: AbortController
  pauseWaiters: Array<() => void>
  persistChain: Promise<void>
  structuralError?: string
  budgetExhausted: boolean
}

function resultOf(run: WorkflowRun): WorkflowResult {
  return { runId: run.runId, status: run.status, result: run.result ?? null, ...(run.error ? { error: run.error } : {}), usage: run.usage, failures: run.failures, worktrees: run.worktrees }
}

function validateAgentOptions(value: unknown): WorkflowAgentOptions {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('agent options must be an object')
  const options = value as Record<string, unknown>
  for (const key of ['label', 'phase', 'model', 'agentType'] as const) {
    if (options[key] !== undefined && typeof options[key] !== 'string') throw new Error(`agent option '${key}' must be a string`)
  }
  if (options.schema !== undefined && (!options.schema || typeof options.schema !== 'object' || Array.isArray(options.schema) || (options.schema as Record<string, unknown>).type !== 'object')) {
    throw new Error("agent option 'schema' must be a JSON Schema with type 'object'")
  }
  if (options.effort !== undefined && !['low', 'high', 'max'].includes(String(options.effort))) throw new Error("agent option 'effort' must be low, high, or max")
  if (options.isolation !== undefined && options.isolation !== 'worktree') throw new Error("agent option 'isolation' must be worktree")
  for (const key of ['timeoutMs', 'maxTokens'] as const) {
    if (options[key] !== undefined && (typeof options[key] !== 'number' || !Number.isFinite(options[key]) || options[key] <= 0)) throw new Error(`agent option '${key}' must be positive`)
  }
  if (options.maxCostUsd !== undefined && (typeof options.maxCostUsd !== 'number' || !Number.isFinite(options.maxCostUsd) || options.maxCostUsd < 0)) throw new Error("agent option 'maxCostUsd' cannot be negative")
  return options as WorkflowAgentOptions
}

function contained(root: string, target: string): boolean {
  const child = relative(root, target)
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

export class WorkflowManager {
  private store: WorkflowStore
  private readonly active = new Map<string, ActiveRun>()
  private readonly listeners = new Set<(event: WorkflowManagerEvent) => void>()
  private callbacks: OrchestratorCallbacks = {}

  constructor(readonly options: WorkflowManagerOptions) {
    this.store = new WorkflowStore(options)
  }

  configure(values: { providerConfig?: ProviderConfig; model?: string; settings?: DeepSeekSettings }): void {
    if (values.providerConfig) this.options.providerConfig = values.providerConfig
    if (values.model) this.options.model = values.model
    if (values.settings) this.options.settings = values.settings
  }

  hasActiveRuns(): boolean {
    return [...this.active.values()].some(active => ['queued', 'running', 'paused'].includes(active.record.status))
  }

  findTask(taskId: string): { workflowRunId: string; task: TaskRecordV1 } | undefined {
    for (const active of this.active.values()) {
      try { return { workflowRunId: active.record.runId, task: active.session.registry.getStatus(taskId) } }
      catch { /* task belongs to another session */ }
    }
    return undefined
  }

  changeProjectRoot(projectRoot: string): void {
    if (this.hasActiveRuns()) throw new Error('Cannot change project root while a workflow is active')
    this.options.projectRoot = projectRoot
    this.store = new WorkflowStore(this.options)
  }

  async shutdown(reason = 'Workflow manager shutdown'): Promise<void> {
    await Promise.all([...this.active.values()].filter(active => ['queued', 'running', 'paused'].includes(active.record.status)).map(active => this.cancel(active.record.runId, reason)))
  }

  subscribe(listener: (event: WorkflowManagerEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setCallbacks(callbacks: OrchestratorCallbacks | null): void {
    this.callbacks = callbacks ?? {}
    for (const active of this.active.values()) active.session.setCallbacks(this.callbacks)
  }

  private publish(active: ActiveRun, event?: WorkflowEvent): void {
    const payload: WorkflowManagerEvent = { type: event ? 'runtime' : 'run', run: structuredClone(active.record), ...(event ? { event } : {}) }
    for (const listener of this.listeners) listener(payload)
  }

  private setPhase(active: ActiveRun, phase: string): void {
    const changed = active.record.phase !== phase
    active.record.phase = phase
    const added = !active.record.phaseHistory?.includes(phase)
    if (added) active.record.phaseHistory = [...(active.record.phaseHistory ?? []), phase]
    if (changed || added) void this.persist(active).catch(error => {
      try { this.callbacks.onError?.(active.record.runId, `Failed to persist workflow phase: ${(error as Error).message}`) } catch { /* phase reporting must not interrupt runtime events */ }
    })
  }

  private persist(active: ActiveRun): Promise<void> {
    active.persistChain = active.persistChain.catch(() => undefined).then(async () => {
      await Promise.all([active.store.writeRun(active.record), active.store.writeJournal(active.record.runId, active.journal)])
    })
    return active.persistChain
  }

  async start(input: StartWorkflowInput): Promise<WorkflowHandle> {
    if (this.options.settings?.workflows?.enabled === false || process.env.DEEPSEEK_DISABLE_WORKFLOWS === '1') {
      throw new Error('Dynamic Workflows are disabled')
    }
    const parsed = parseWorkflowSource(input.script, input.name)
    const runId = randomUUID()
    const scriptHash = hashWorkflowValue(input.script)
    const argsHash = hashWorkflowValue(input.args ?? {})
    const runOptions: WorkflowRunOptions = {
      ...(input.name ? { name: input.name } : {}), ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.maxTokens ? { maxTokens: input.maxTokens } : {}), ...(input.maxCostUsd !== undefined ? { maxCostUsd: input.maxCostUsd } : {}),
    }
    const optionsHash = hashWorkflowValue(runOptions)
    const record: WorkflowRun = {
      runId, sessionId: this.options.sessionId, projectRoot: this.options.projectRoot, meta: parsed.meta,
      status: 'queued', scriptHash, argsHash, optionsHash, options: runOptions, createdAt: new Date().toISOString(),
      usage: { agents: 0, tokens: 0, costUsd: 0 }, failures: [], worktrees: [],
    }
    const settings = this.options.settings ?? {}
    const session = new OrchestratorSession({
      sessionId: `${this.options.sessionId}:workflow:${runId}`, projectRoot: this.options.projectRoot,
      providerConfig: this.options.providerConfig, model: this.options.model, settings,
      limits: { concurrency: Math.min(settings.agents?.concurrency ?? 5, MAX_CONCURRENCY), maxTasks: MAX_AGENTS, maxFanOut: MAX_AGENTS },
      snapshotFile: null,
    })
    session.setCallbacks(this.callbacks)
    const active: ActiveRun = {
      record, script: input.script, args: input.args ?? {}, store: this.store,
      journal: { schemaVersion: 1, scriptHash, argsHash, optionsHash, entries: [] },
      replay: await this.store.findReplay(scriptHash, argsHash, optionsHash), replayValid: true, nextCall: 0,
      session, controller: new AbortController(), pauseWaiters: [], persistChain: Promise.resolve(), budgetExhausted: false,
    }
    this.active.set(runId, active)
    try {
      await this.store.createRun(record, input.script, input.args ?? {})
      record.status = 'running'
      record.startedAt = new Date().toISOString()
      await this.persist(active)
    } catch (error) {
      this.active.delete(runId)
      await session.shutdown('Workflow failed to start')
      throw error
    }
    this.publish(active)

    const runPromise = this.run(active, input)
    return { runId, result: runPromise, cancel: reason => { void this.cancel(runId, reason) } }
  }

  private async run(active: ActiveRun, input: StartWorkflowInput): Promise<WorkflowResult> {
    try {
      active.execution = executeWorkflowScript({
        script: active.script, name: input.name, args: active.args, timeoutMs: input.timeoutMs,
        maxTokens: input.maxTokens, maxCostUsd: input.maxCostUsd, signal: active.controller.signal,
        onEvent: event => {
          if (event.type === 'phase') this.setPhase(active, event.value)
          this.publish(active, event)
        },
        onCall: (method, args) => this.handleCall(active, method, args, input),
      })
      const runtime = await active.execution.result
      active.record.result = runtime.value
      active.record.usage = { ...runtime.usage, agents: active.record.usage.agents }
      active.record.status = active.structuralError ? 'failed' : active.budgetExhausted ? 'budget_exhausted' : 'completed'
      if (active.structuralError) active.record.error = active.structuralError
    } catch (error) {
      const message = (error as Error).message
      active.record.error = message
      if (active.controller.signal.aborted) active.record.status = 'cancelled'
      else if (/timed out/i.test(message)) active.record.status = 'timed_out'
      else active.record.status = 'failed'
    } finally {
      active.record.completedAt = new Date().toISOString()
      await active.session.shutdown(`Workflow ${active.record.status}`)
      try {
        try { await this.persist(active) }
        catch (error) {
          try { this.callbacks.onError?.(active.record.runId, `Failed to persist workflow result: ${(error as Error).message}`) } catch { /* reporting must not break cleanup */ }
        }
        this.publish(active)
      } finally { this.active.delete(active.record.runId) }
    }
    return resultOf(active.record)
  }

  private async waitIfPaused(active: ActiveRun): Promise<void> {
    while (active.record.status === 'paused') {
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(active.controller.signal.reason ?? new Error('Workflow cancelled'))
        active.pauseWaiters.push(() => { active.controller.signal.removeEventListener('abort', abort); resolve() })
        active.controller.signal.addEventListener('abort', abort, { once: true })
      })
    }
  }

  private replayEntry(active: ActiveRun, index: number, fingerprint: string): WorkflowJournalEntry | undefined {
    if (!active.replayValid) return undefined
    const entry = active.replay?.entries[index]
    if (!entry || entry.status !== 'completed' || entry.fingerprint !== fingerprint) {
      active.replayValid = false
      return undefined
    }
    return entry
  }

  private async handleCall(active: ActiveRun, method: 'agent' | 'workflow', args: unknown[], input: StartWorkflowInput): Promise<WorkflowRpcResult> {
    await this.waitIfPaused(active)
    if (active.controller.signal.aborted) throw active.controller.signal.reason
    const index = active.nextCall++
    const fingerprint = hashWorkflowValue({ method, args })
    const replay = this.replayEntry(active, index, fingerprint)
    if (replay) {
      active.journal.entries[index] = { ...replay, index, usage: replay.usage }
      if (replay.budgetExhausted) active.budgetExhausted = true
      active.record.usage.agents += replay.usage?.agents ?? (method === 'agent' ? 1 : 0)
      active.record.usage.tokens += replay.usage?.tokens ?? 0
      active.record.usage.costUsd += replay.usage?.costUsd ?? 0
      await this.persist(active)
      this.publish(active)
      return { value: replay.result, usage: replay.usage }
    }
    const entry: WorkflowJournalEntry = { index, fingerprint, method, args, status: 'running', timestamp: new Date().toISOString() }
    active.journal.entries[index] = entry
    await this.persist(active)
    try {
      const initialAgents = active.record.usage.agents
      const reply = method === 'agent'
        ? await this.runAgent(active, args, input, index)
        : await this.runChild(active, args, input, index)
      const usage = { ...reply.usage, agents: reply.usage?.agents ?? active.record.usage.agents - initialAgents }
      Object.assign(entry, { status: 'completed', result: reply.value, usage, budgetExhausted: active.budgetExhausted || undefined, timestamp: new Date().toISOString() })
      await this.persist(active)
      return reply
    } catch (error) {
      const message = (error as Error).message
      Object.assign(entry, { status: 'failed', error: message, timestamp: new Date().toISOString() })
      active.record.failures.push({ call: index, method, message })
      await this.persist(active)
      throw error
    }
  }

  private budgetReached(active: ActiveRun, input: StartWorkflowInput): boolean {
    return (input.maxTokens !== undefined && active.record.usage.tokens >= input.maxTokens) ||
      (input.maxCostUsd !== undefined && active.record.usage.costUsd >= input.maxCostUsd)
  }

  private async runAgent(active: ActiveRun, args: unknown[], input: StartWorkflowInput, callIndex: number): Promise<WorkflowAgentResponse> {
    if (this.budgetReached(active, input)) { active.budgetExhausted = true; this.publish(active); return { value: null } }
    if (active.record.usage.agents >= MAX_AGENTS) {
      const message = `Workflow exceeds the ${MAX_AGENTS}-agent limit`
      active.structuralError = message
      throw new Error(message)
    }
    const prompt = args[0]
    let options: WorkflowAgentOptions
    try { options = validateAgentOptions(args[1]) } catch (error) {
      active.structuralError = (error as Error).message
      throw error
    }
    if (options.phase) {
      this.setPhase(active, options.phase)
      this.publish(active, { type: 'phase', value: options.phase, timestamp: new Date().toISOString() })
    }
    if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('agent prompt must be a non-empty string')
    const interactionMode = this.options.interactionMode?.() ?? 'build'
    if (['plan', 'review'].includes(interactionMode) && options.isolation === 'worktree') throw new Error(`Writer agents are blocked in ${interactionMode} mode`)
    active.record.usage.agents++
    this.publish(active)
    const runner = this.options.agentRunner ?? defaultAgentRunner
    try {
      const reply = await runner({ prompt, options, session: active.session, interactionMode, signal: active.controller.signal })
      active.record.usage.tokens += reply.usage?.tokens ?? 0
      active.record.usage.costUsd += reply.usage?.costUsd ?? 0
      if (reply.worktree && reply.taskId && !active.record.worktrees.some(item => item.taskId === reply.taskId)) {
        active.record.worktrees.push({ taskId: reply.taskId, path: reply.worktree })
      }
      if (reply.error) active.record.failures.push({ call: callIndex, method: 'agent', message: reply.error })
      this.publish(active)
      return reply.error ? { ...reply, value: null } : reply
    } catch (error) {
      active.record.failures.push({ call: callIndex, method: 'agent', message: (error as Error).message })
      this.publish(active)
      return { value: null }
    }
  }

  private async runChild(active: ActiveRun, args: unknown[], input: StartWorkflowInput, callIndex: number): Promise<WorkflowRpcResult> {
    const name = args[0]
    if (typeof name !== 'string' || !isWorkflowName(name)) {
      active.structuralError = 'Invalid child workflow name'
      throw new Error(active.structuralError)
    }
    const source = await this.loadWorkflow(name)
    if (!source) throw new Error(`Workflow '${name}' not found`)
    const approved = await new WorkflowApprovalStore(this.options.projectRoot).isApproved(hashWorkflowValue(source))
    if (!approved) throw new Error(`Child workflow '${name}' requires approval before execution`)
    const initialAgents = active.record.usage.agents
    const execution = executeWorkflowScript({
      script: source, args: args[1] ?? {}, timeoutMs: input.timeoutMs,
      maxTokens: input.maxTokens, maxCostUsd: input.maxCostUsd, signal: active.controller.signal,
      onEvent: event => {
        if (event.type === 'phase') this.setPhase(active, event.value)
        this.publish(active, event)
      },
      onCall: async (method, childArgs) => {
        if (method === 'workflow') throw new Error('Child workflows cannot start another workflow')
        return this.runAgent(active, childArgs, input, callIndex)
      },
    })
    const result = await execution.result
    return { value: result.value, usage: { agents: active.record.usage.agents - initialAgents, tokens: result.usage.tokens, costUsd: result.usage.costUsd } }
  }

  private async loadWorkflow(name: string): Promise<string | undefined> {
    if (this.options.workflowLoader) return this.options.workflowLoader(name)
    const workflow = (await discoverWorkflows(this.options.projectRoot)).find(item => item.meta.name === name)
    return workflow ? readFile(workflow.path, 'utf8') : undefined
  }

  private async resolveRunId(runId: string): Promise<string | undefined> {
    if (!RUN_ID_INPUT.test(runId)) return undefined
    if (this.active.has(runId) || await this.store.readRun(runId)) return runId
    const matches = (await this.store.listRuns()).filter(run => run.runId.startsWith(runId))
    return matches.length === 1 ? matches[0]!.runId : undefined
  }

  async pause(runId: string): Promise<boolean> {
    const active = this.active.get(await this.resolveRunId(runId) ?? '')
    if (!active || active.record.status !== 'running') return false
    active.record.status = 'paused'
    await this.persist(active)
    this.publish(active)
    return true
  }

  async resume(runId: string): Promise<boolean> {
    const active = this.active.get(await this.resolveRunId(runId) ?? '')
    if (!active || active.record.status !== 'paused') return false
    active.record.status = 'running'
    const waiters = active.pauseWaiters.splice(0)
    await this.persist(active)
    this.publish(active)
    setTimeout(() => { for (const resume of waiters) resume() }, 0)
    return true
  }

  async cancel(runId: string, reason = 'Workflow cancelled by user'): Promise<boolean> {
    const active = this.active.get(await this.resolveRunId(runId) ?? '')
    if (!active || !['queued', 'running', 'paused'].includes(active.record.status)) return false
    active.controller.abort(new Error(reason))
    active.execution?.cancel(reason)
    for (const resume of active.pauseWaiters.splice(0)) resume()
    return true
  }

  async restart(runId: string): Promise<WorkflowHandle> {
    return this.start(await this.loadRunInput(runId))
  }

  async loadRunInput(runId: string): Promise<StartWorkflowInput> {
    const resolved = await this.resolveRunId(runId)
    if (!resolved) throw new Error(`Workflow run '${runId}' not found`)
    const [run, script, args] = await Promise.all([this.store.readRun(resolved), this.store.readScript(resolved), this.store.readArgs(resolved)])
    if (!run || !script) throw new Error(`Workflow run '${runId}' not found`)
    return { script, args, ...run.options }
  }

  async save(runId: string, name: string): Promise<string> {
    if (!isWorkflowName(name)) throw new Error('Invalid workflow name')
    const resolved = await this.resolveRunId(runId)
    const [run, script] = resolved ? await Promise.all([this.store.readRun(resolved), this.store.readScript(resolved)]) : []
    if (!run || !script) throw new Error(`Workflow run '${runId}' not found`)
    const parsed = parseWorkflowSource(script, run.meta.name)
    const directory = join(this.options.projectRoot, '.deepseek', 'workflows')
    const path = join(directory, `${name}.js`)
    const configDirectory = join(this.options.projectRoot, '.deepseek')
    for (const candidate of [configDirectory, directory]) {
      try { if ((await lstat(candidate)).isSymbolicLink()) throw new Error(`Refusing to write through symlink: ${candidate}`) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    await mkdir(directory, { recursive: true })
    const [realProject, realDirectory] = await Promise.all([realpath(resolve(this.options.projectRoot)), realpath(directory)])
    if (!contained(realProject, realDirectory)) throw new Error('Workflow directory escapes the project root')
    try { if ((await lstat(path)).isSymbolicLink()) throw new Error('Refusing to overwrite a workflow symlink') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await writeFile(path, formatWorkflowSource({ ...parsed.meta, name }, parsed.body), { mode: 0o600, flag: 'wx' })
    return path
  }

  async get(runId: string): Promise<WorkflowRun | undefined> {
    const resolved = await this.resolveRunId(runId)
    return resolved ? this.active.get(resolved)?.record ?? this.store.readRun(resolved) : undefined
  }

  async list(): Promise<WorkflowRun[]> {
    const persisted = await this.store.listRuns()
    return persisted.map(run => this.active.get(run.runId)?.record ?? run)
  }

  async formatRuns(): Promise<string> {
    const runs = await this.list()
    if (!runs.length) return 'No workflow runs.'
    return ['Dynamic Workflows:', ...runs.map(run => {
      const phase = run.phase ? ` · ${run.phase}` : ''
      return `  ${run.runId.slice(0, 8)}  ${run.meta.name}  ${run.status}${phase} · ${run.usage.agents} agents · ${run.usage.tokens} tokens`
    })].join('\n')
  }
}

async function defaultAgentRunner(request: WorkflowAgentRequest): Promise<WorkflowAgentResponse> {
  const { spawnWorkflowAgentTask } = await import('../tools/SubAgent/SubAgent.js')
  const readOnly = request.interactionMode === 'plan' || request.interactionMode === 'review'
  if (readOnly && request.options.agentType) {
    const { loadAgentConfig } = await import('../agent/config.js')
    const selected = (await loadAgentConfig(request.options.agentType, request.session.projectRoot)).config
    const safe = selected.permissionProfile === 'researcher-readonly' || selected.role === 'reader' || selected.role === 'reviewer'
    if (!safe) throw new Error(`Agent '${request.options.agentType}' is not read-only and cannot run in ${request.interactionMode} mode`)
  }
  const spawned = await spawnWorkflowAgentTask({
    task: request.prompt,
    ...(request.options.label ? { label: request.options.label } : {}),
    ...(request.options.model ? { model: request.options.model } : {}),
    ...(request.options.agentType ? { agent: request.options.agentType } : {}),
    ...(request.options.effort ? { effort: request.options.effort } : {}),
    ...(readOnly ? { role: 'reader' } : request.options.isolation === 'worktree' ? { role: 'writer' } : {}),
    ...(request.options.timeoutMs ? { timeoutMs: request.options.timeoutMs } : {}),
    ...(request.options.maxTokens !== undefined ? { maxTokens: request.options.maxTokens } : {}),
    ...(request.options.maxCostUsd !== undefined ? { maxCostUsd: request.options.maxCostUsd } : {}),
  }, request.session.toolContext({ signal: request.signal, permissionProfile: 'coordinator-integrator' }), request.options.schema)
  const result = await spawned.handle.awaitResult()
  const record = spawned.handle.status()
  return {
    value: result.status === 'done' ? result.value ?? null : null,
    usage: { tokens: result.metrics.tokens, costUsd: result.metrics.costUsd },
    taskId: spawned.handle.taskId,
    worktree: record.workspace?.isolation === 'git-worktree' ? record.workspace.path : undefined,
    error: result.status === 'done' ? undefined : result.error?.message ?? `Agent ${result.status}`,
  }
}
