import type { Store } from '../store/store.js'
import type { EventBus } from '../events/eventBus.js'
import { randomUUID } from 'node:crypto'

// ── Workflow Engine ─────────────────────────────────────────────────

export interface WorkflowDefinition {
  name: string
  version: number
  phases: WorkflowPhase[]
  /** Max wall-clock time for the entire workflow. */
  timeout_ms?: number
  /** Default model for agents in this workflow. */
  default_model?: string
  metadata?: Record<string, unknown>
}

export interface WorkflowPhase {
  title: string
  /** Number of parallel agents to spawn. */
  fan_out: number
  /** Agent role for this phase. */
  role: 'planner' | 'reader' | 'writer' | 'executor' | 'reviewer' | 'verifier'
  /** Prompt template. ${task} and ${context} are substituted. */
  prompt_template: string
  /** Dependencies on previous phases (by title). */
  depends_on?: string[]
  timeout_ms?: number
}

export interface WorkflowRun {
  run_id: string
  workflow_name: string
  workflow_version: number
  status: 'queued' | 'running' | 'completed' | 'failed'
  current_phase?: string
  task_ids: string[]
  started_at: string
  completed_at?: string
  error?: string
}

export interface WorkflowContext {
  task: string
  context?: string
  artifacts?: Record<string, unknown>
}

interface WorkflowRunRow {
  run_id: string
  workflow_name: string
  workflow_version: number
  status: string
  current_phase: string | null
  task_ids: string
  started_at: string
  completed_at: string | null
  error: string | null
}

/**
 * Durable workflow engine. Runs are persisted to the `workflow_runs` table
 * (migration v5) and rehydrated on construction. Phases advance only after
 * their spawned tasks complete successfully (via the `waitTasks` callback).
 */
export class WorkflowEngine {
  private readonly runs = new Map<string, WorkflowRun>()

  constructor(
    private readonly store: Store,
    private readonly events: EventBus,
  ) {
    this.rehydrate()
  }

  /**
   * Register and start a workflow. Returns the run ID for tracking.
   * `waitTasks` resolves to true when every spawned task completed
   * successfully; a phase does not complete and dependent phases do not
   * start until it does.
   */
  async start(
    definition: WorkflowDefinition,
    context: WorkflowContext,
    spawnTask: (phase: WorkflowPhase, prompt: string) => string,
    waitTasks?: (taskIds: string[]) => Promise<boolean>,
  ): Promise<WorkflowRun> {
    const runId = randomUUID()
    const run: WorkflowRun = {
      run_id: runId,
      workflow_name: definition.name,
      workflow_version: definition.version,
      status: 'running',
      task_ids: [],
      started_at: new Date().toISOString(),
    }
    this.persistRun(run)

    const phaseOrder = this.topologicalSort(definition.phases)
    const completed = new Set<string>()

    for (const phase of phaseOrder) {
      if (phase.depends_on) {
        for (const dep of phase.depends_on) {
          if (!completed.has(dep)) {
            this.fail(run, `Phase '${phase.title}' depends on '${dep}' which is not yet complete`)
            return run
          }
        }
      }

      run.current_phase = phase.title
      this.persistRun(run)
      this.events.emit('WorkflowPhaseStarted', { run_id: runId, phase: phase.title }, {})

      // Substitute template variables with replacer functions so `$&`, `$1`,
      // and other dollar sequences inside free-form task/context text survive.
      const prompt = this.substitute(phase.prompt_template, context)

      const spawnedIds: string[] = []
      try {
        for (let i = 0; i < phase.fan_out; i++) {
          const taskId = spawnTask(phase, prompt)
          spawnedIds.push(taskId)
          run.task_ids.push(taskId)
          this.persistRun(run)
          this.events.emit('WorkflowTaskSpawned', {
            run_id: runId, phase: phase.title, task_id: taskId, index: i,
          }, { task_id: taskId })
        }
      } catch (err) {
        // Preserve IDs already spawned in earlier iterations.
        const message = err instanceof Error ? err.message : String(err)
        this.fail(run, `Failed to spawn tasks for phase '${phase.title}': ${message}`)
        return run
      }

      // Do not advance until this phase's tasks have actually completed.
      if (waitTasks) {
        const ok = await waitTasks(spawnedIds)
        if (!ok) {
          this.fail(run, `Tasks for phase '${phase.title}' did not complete successfully`)
          return run
        }
      }

      completed.add(phase.title)
    }

    run.status = 'completed'
    run.completed_at = new Date().toISOString()
    this.persistRun(run)
    this.events.emit('WorkflowCompleted', {
      run_id: runId, workflow: definition.name, tasks: run.task_ids.length,
    }, {})

    return run
  }

  /** Get a workflow run by ID. */
  getRun(runId: string): WorkflowRun | undefined {
    return this.runs.get(runId)
  }

  /** List all workflow runs. */
  listRuns(): WorkflowRun[] {
    return [...this.runs.values()]
  }

  private substitute(template: string, context: WorkflowContext): string {
    let prompt = template.replace(/\$\{task\}/g, () => context.task)
    prompt = prompt.replace(/\$\{context\}/g, () => context.context ?? '')
    return prompt
  }

  private fail(run: WorkflowRun, message: string): void {
    run.status = 'failed'
    run.error = message
    run.completed_at = new Date().toISOString()
    this.persistRun(run)
    this.events.emit('WorkflowFailed', { run_id: run.run_id, error: message }, {})
  }

  private persistRun(run: WorkflowRun): void {
    this.runs.set(run.run_id, run)
    this.store.run(
      `INSERT OR REPLACE INTO workflow_runs
        (run_id, workflow_name, workflow_version, status, current_phase, task_ids, started_at, completed_at, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      run.run_id, run.workflow_name, run.workflow_version, run.status,
      run.current_phase ?? null, JSON.stringify(run.task_ids), run.started_at,
      run.completed_at ?? null, run.error ?? null,
    )
  }

  private rehydrate(): void {
    const rows = this.store.query<WorkflowRunRow>('SELECT * FROM workflow_runs')
    for (const row of rows) {
      this.runs.set(row.run_id, {
        run_id: row.run_id,
        workflow_name: row.workflow_name,
        workflow_version: row.workflow_version,
        status: row.status as WorkflowRun['status'],
        current_phase: row.current_phase ?? undefined,
        task_ids: this.parseJsonArray(row.task_ids),
        started_at: row.started_at,
        completed_at: row.completed_at ?? undefined,
        error: row.error ?? undefined,
      })
    }
  }

  private parseJsonArray(value: string): string[] {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  private topologicalSort(phases: WorkflowPhase[]): WorkflowPhase[] {
    const byTitle = new Map(phases.map(p => [p.title, p]))
    const visited = new Set<string>()
    const sorted: WorkflowPhase[] = []

    const visit = (title: string) => {
      if (visited.has(title)) return
      visited.add(title)
      const phase = byTitle.get(title)
      if (phase?.depends_on) {
        for (const dep of phase.depends_on) visit(dep)
      }
      if (phase) sorted.push(phase)
    }

    for (const phase of phases) visit(phase.title)
    return sorted
  }
}

// ── Predefined Workflows ────────────────────────────────────────────

export const REVIEW_WORKFLOW: WorkflowDefinition = {
  name: 'multi-perspective-review',
  version: 1,
  phases: [
    { title: 'Find', fan_out: 3, role: 'reviewer',
      prompt_template: 'Review the following change for issues. Focus on: ${task}\n\nContext: ${context}',
      timeout_ms: 60_000 },
    { title: 'Verify', fan_out: 2, role: 'verifier',
      prompt_template: 'Verify the findings from the previous review phase. Task: ${task}',
      depends_on: ['Find'],
      timeout_ms: 60_000 },
  ],
}

export const IMPLEMENT_WORKFLOW: WorkflowDefinition = {
  name: 'implement-and-review',
  version: 1,
  phases: [
    { title: 'Plan', fan_out: 1, role: 'planner',
      prompt_template: 'Plan the implementation for: ${task}\n\nContext: ${context}',
      timeout_ms: 60_000 },
    { title: 'Implement', fan_out: 1, role: 'writer',
      prompt_template: 'Implement the plan for: ${task}',
      depends_on: ['Plan'],
      timeout_ms: 120_000 },
    { title: 'Review', fan_out: 2, role: 'reviewer',
      prompt_template: 'Review the implementation for: ${task}',
      depends_on: ['Implement'],
      timeout_ms: 60_000 },
  ],
}

export const RESEARCH_WORKFLOW: WorkflowDefinition = {
  name: 'deep-research',
  version: 1,
  phases: [
    { title: 'Scan', fan_out: 4, role: 'reader',
      prompt_template: 'Research the following topic from different angles: ${task}\nAngle: explore file structure, dependencies, patterns, and risks.',
      timeout_ms: 60_000 },
    { title: 'Synthesize', fan_out: 1, role: 'planner',
      prompt_template: 'Synthesize the research findings for: ${task}',
      depends_on: ['Scan'],
      timeout_ms: 60_000 },
  ],
}
