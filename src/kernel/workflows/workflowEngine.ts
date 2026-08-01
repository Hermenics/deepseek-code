import type { Store } from '../store/store.js'
import type { EventBus } from '../events/eventBus.js'
import { randomUUID } from 'node:crypto'

interface WorkflowRunRow { run_id: string; workflow_name: string; workflow_version: number; status: string; current_phase: string | null; task_ids: string; session_id: string; started_at: string; completed_at: string | null; error: string | null }

export interface WorkflowDefinition { name: string; version: number; phases: WorkflowPhase[]; timeout_ms?: number; default_model?: string; metadata?: Record<string, unknown> }
export interface WorkflowPhase { title: string; fan_out: number; role: 'planner' | 'reader' | 'writer' | 'executor' | 'reviewer' | 'verifier'; prompt_template: string; depends_on?: string[]; timeout_ms?: number }
export interface WorkflowRun { run_id: string; workflow_name: string; workflow_version: number; status: 'queued' | 'running' | 'completed' | 'failed'; current_phase?: string; task_ids: string[]; session_id: string; started_at: string; completed_at?: string; error?: string }
export interface WorkflowContext { task: string; context?: string; artifacts?: Record<string, unknown> }

export class WorkflowEngine {
  private readonly runs = new Map<string, WorkflowRun>()

  constructor(private readonly store: Store, private readonly events: EventBus) { this.rehydrate() }

  /**
   * Start a workflow. waitTasks is REQUIRED — phases do not advance until
   * tasks actually complete. Phase timeouts ensure a never-settling
   * waitTasks cannot leave the run running indefinitely.
   */
  async start(
    definition: WorkflowDefinition,
    context: WorkflowContext,
    spawnTask: (phase: WorkflowPhase, prompt: string) => string,
    waitTasks: (taskIds: string[]) => Promise<boolean>,
    cancelTask?: (taskId: string) => void,
  ): Promise<WorkflowRun> {
    const runId = randomUUID(); const now = new Date().toISOString()
    const run: WorkflowRun = { run_id: runId, workflow_name: definition.name, workflow_version: definition.version, status: 'running', task_ids: [], session_id: this.events.sessionId, started_at: now }
    this.persistRun(run)

    const phaseOrder = this.topologicalSort(definition.phases); const completed = new Set<string>()
    for (const phase of phaseOrder) {
      if (phase.depends_on) { for (const dep of phase.depends_on) { if (!completed.has(dep)) { this.fail(run, `Phase '${phase.title}' depends on '${dep}'`); return run } } }

      run.current_phase = phase.title; this.persistRun(run)
      this.events.emit('WorkflowPhaseStarted', { run_id: runId, phase: phase.title }, {})

      const prompt = substitute(phase.prompt_template, context)
      const spawnedIds: string[] = []
      try { for (let i = 0; i < phase.fan_out; i++) { const tid = spawnTask(phase, prompt); spawnedIds.push(tid); run.task_ids.push(tid); this.persistRun(run); this.events.emit('WorkflowTaskSpawned', { run_id: runId, phase: phase.title, task_id: tid, index: i }, { task_id: tid }) } }
      catch (err) { for (const tid of spawnedIds) cancelTask?.(tid); this.fail(run, `Failed to spawn tasks for '${phase.title}': ${err instanceof Error ? err.message : String(err)}`); return run }

      // Phase timeout: a waitTasks that never settles fails the run.
      const phaseTimeout = phase.timeout_ms ?? definition.timeout_ms ?? 300_000
      const ok = await Promise.race([waitTasks(spawnedIds), timeout(phaseTimeout).then(() => false)])
      if (!ok) { for (const tid of spawnedIds) cancelTask?.(tid); this.fail(run, `Tasks for '${phase.title}' did not complete successfully`); return run }
      completed.add(phase.title)
    }

    run.status = 'completed'; run.completed_at = new Date().toISOString(); this.persistRun(run)
    this.events.emit('WorkflowCompleted', { run_id: runId, workflow: definition.name, tasks: run.task_ids.length }, {})
    return run
  }

  /** Get a run by ID. Only returns runs owned by this session. */
  getRun(runId: string): WorkflowRun | undefined {
    const r = this.runs.get(runId); return (r && r.session_id === this.events.sessionId) ? r : undefined
  }
  /** List runs owned by this session. */
  listRuns(): WorkflowRun[] { return [...this.runs.values()].filter(r => r.session_id === this.events.sessionId) }

  private fail(run: WorkflowRun, message: string): void { run.status = 'failed'; run.error = message; run.completed_at = new Date().toISOString(); this.persistRun(run); this.events.emit('WorkflowFailed', { run_id: run.run_id, error: message }, {}) }

  private persistRun(run: WorkflowRun): void {
    this.runs.set(run.run_id, run)
    this.store.run(`INSERT OR REPLACE INTO workflow_runs (run_id, workflow_name, workflow_version, status, current_phase, task_ids, session_id, started_at, completed_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, run.run_id, run.workflow_name, run.workflow_version, run.status, run.current_phase ?? null, JSON.stringify(run.task_ids), run.session_id, run.started_at, run.completed_at ?? null, run.error ?? null)
  }

  private rehydrate(): void {
    const rows = this.store.query<WorkflowRunRow>('SELECT * FROM workflow_runs')
    for (const row of rows) {
      // Mark stale running records as interrupted — they did not survive the crash.
      const status = row.status === 'running' ? 'failed' : row.status
      const error = row.status === 'running' ? (row.error ?? 'Interrupted — process restarted') : (row.error ?? undefined)
      this.runs.set(row.run_id, {
        run_id: row.run_id, workflow_name: row.workflow_name, workflow_version: row.workflow_version,
        status: status as WorkflowRun['status'], current_phase: row.current_phase ?? undefined,
        task_ids: parseArray(row.task_ids), session_id: row.session_id, started_at: row.started_at,
        completed_at: row.completed_at ?? undefined, error,
      })
    }
  }

  private topologicalSort(phases: WorkflowPhase[]): WorkflowPhase[] {
    const m = new Map(phases.map(p => [p.title, p])); const v = new Set<string>(); const s: WorkflowPhase[] = []
    const visit = (t: string) => { if (v.has(t)) return; v.add(t); const p = m.get(t); if (p?.depends_on) for (const d of p.depends_on) visit(d); if (p) s.push(p) }
    for (const p of phases) visit(p.title); return s
  }
}

function substitute(template: string, ctx: WorkflowContext): string { return template.replace(/\$\{task\}/g, () => ctx.task).replace(/\$\{context\}/g, () => ctx.context ?? '') }
function parseArray(v: string): string[] { try { const p = JSON.parse(v); return Array.isArray(p) ? p : [] } catch { return [] } }
function timeout(ms: number): Promise<never> { return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)) }

export const REVIEW_WORKFLOW: WorkflowDefinition = { name: 'multi-perspective-review', version: 1, phases: [{ title: 'Find', fan_out: 3, role: 'reviewer', prompt_template: 'Review for issues: ${task}\n\nContext: ${context}', timeout_ms: 60_000 }, { title: 'Verify', fan_out: 2, role: 'verifier', prompt_template: 'Verify findings. Task: ${task}', depends_on: ['Find'], timeout_ms: 60_000 }] }
export const IMPLEMENT_WORKFLOW: WorkflowDefinition = { name: 'implement-and-review', version: 1, phases: [{ title: 'Plan', fan_out: 1, role: 'planner', prompt_template: 'Plan: ${task}\n\nContext: ${context}', timeout_ms: 60_000 }, { title: 'Implement', fan_out: 1, role: 'writer', prompt_template: 'Implement: ${task}', depends_on: ['Plan'], timeout_ms: 120_000 }, { title: 'Review', fan_out: 2, role: 'reviewer', prompt_template: 'Review: ${task}', depends_on: ['Implement'], timeout_ms: 60_000 }] }
export const RESEARCH_WORKFLOW: WorkflowDefinition = { name: 'deep-research', version: 1, phases: [{ title: 'Scan', fan_out: 4, role: 'reader', prompt_template: 'Research: ${task}', timeout_ms: 60_000 }, { title: 'Synthesize', fan_out: 1, role: 'planner', prompt_template: 'Synthesize: ${task}', depends_on: ['Scan'], timeout_ms: 60_000 }] }
