import type { Store } from '../store/store.js'
import type { EventBus } from '../events/eventBus.js'
import type { TaskBoard } from '../tasks/taskBoard.js'
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

export class WorkflowEngine {
  private readonly runs = new Map<string, WorkflowRun>()

  constructor(
    private readonly store: Store,
    private readonly events: EventBus,
  ) {}

  /** Register and start a workflow. Returns the run ID for tracking. */
  start(
    definition: WorkflowDefinition,
    context: WorkflowContext,
    spawnTask: (phase: WorkflowPhase, prompt: string) => string,
  ): WorkflowRun {
    const runId = randomUUID()
    const now = new Date().toISOString()

    const run: WorkflowRun = {
      run_id: runId,
      workflow_name: definition.name,
      workflow_version: definition.version,
      status: 'running',
      task_ids: [],
      started_at: now,
    }

    // Resolve phases in dependency order
    const completed = new Set<string>()
    const phaseOrder = this.topologicalSort(definition.phases)

    for (const phase of phaseOrder) {
      // Check dependencies are complete
      if (phase.depends_on) {
        for (const dep of phase.depends_on) {
          if (!completed.has(dep)) {
            run.status = 'failed'
            run.error = `Phase '${phase.title}' depends on '${dep}' which is not yet complete`
            run.completed_at = new Date().toISOString()
            this.runs.set(runId, run)
            this.events.emit('WorkflowFailed', { run_id: runId, error: run.error }, {})
            return run
          }
        }
      }

      run.current_phase = phase.title

      // Substitute template variables
      let prompt = phase.prompt_template
        .replace(/\$\{task\}/g, context.task)
        .replace(/\$\{context\}/g, context.context ?? '')

      // Spawn fan-out tasks
      for (let i = 0; i < phase.fan_out; i++) {
        const taskId = spawnTask(phase, prompt)
        run.task_ids.push(taskId)
        this.events.emit('WorkflowTaskSpawned', {
          run_id: runId, phase: phase.title, task_id: taskId, index: i,
        }, { task_id: taskId })
      }

      completed.add(phase.title)
    }

    run.status = 'completed'
    run.completed_at = new Date().toISOString()
    this.runs.set(runId, run)
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
