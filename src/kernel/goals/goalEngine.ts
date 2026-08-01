import type { Store } from '../store/store.js'
import type { EventBus } from '../events/eventBus.js'
import { GoalRepo, type GoalRow, type GoalStatus } from '../store/repositories.js'
import { createHash, randomUUID } from 'node:crypto'

// ── Goal Engine ─────────────────────────────────────────────────────

export type CriterionKind = 'command' | 'test' | 'artifact' | 'evaluator' | 'human'
export type CriterionStatus = 'pending' | 'passed' | 'failed'

export interface Criterion {
  id: string
  kind: CriterionKind
  spec: string
  required: boolean
  status: CriterionStatus
  result?: string
}

export interface GoalEvaluation {
  goal_id: string
  criteria_results: Array<{ id: string; status: CriterionStatus; result?: string }>
  all_required_passed: boolean
  evaluator_reason?: string
  progress_delta: string
  evaluated_at: string
}

export class GoalEngine {
  readonly repo: GoalRepo

  constructor(
    private readonly store: Store,
    private readonly events: EventBus,
  ) {
    this.repo = new GoalRepo(store, events)
  }

  /** Create a goal with criteria. */
  create(input: {
    thread_id: string
    objective: string
    token_budget?: number
    max_continuations?: number
    criteria: Array<{ kind: CriterionKind; spec: string; required?: boolean }>
  }): GoalRow {
    const goal = this.repo.create({
      thread_id: input.thread_id,
      objective: input.objective,
      token_budget: input.token_budget,
      max_continuations: input.max_continuations,
    })

    for (let i = 0; i < input.criteria.length; i++) {
      const c = input.criteria[i]!
      this.repo.addCriteria({
        goal_id: goal.goal_id,
        sequence: i,
        kind: c.kind,
        spec: c.spec,
        required: c.required !== false ? 1 : 0,
      })
    }

    return goal
  }

  /** Evaluate a goal against its criteria. */
  evaluate(goalId: string): GoalEvaluation {
    const goal = this.repo.get(goalId)
    if (!goal) throw new Error(`Goal '${goalId}' not found`)

    const criteria = this.repo.listCriteria(goalId)
    const results: GoalEvaluation['criteria_results'] = []

    let allRequiredPassed = true
    for (const c of criteria) {
      // Deterministic criteria are evaluated externally and updated via updateCriteria
      // This method collects the current state
      results.push({ id: c.id, status: c.status, result: c.result ?? undefined })
      if (c.required === 1 && c.status !== 'passed') allRequiredPassed = false
    }

    const evaluation: GoalEvaluation = {
      goal_id: goalId,
      criteria_results: results,
      all_required_passed: allRequiredPassed,
      evaluator_reason: allRequiredPassed ? 'All required criteria passed' : 'Some required criteria are not yet passed',
      progress_delta: `${results.filter(r => r.status === 'passed').length}/${results.length} criteria passed`,
      evaluated_at: new Date().toISOString(),
    }

    this.events.emit('GoalEvaluated', {
      goal_id: goalId,
      all_required_passed: allRequiredPassed,
      progress: evaluation.progress_delta,
    }, { goal_id: goalId })

    return evaluation
  }

  /** Check if goal can be completed and complete it if so. */
  tryComplete(goalId: string): { completed: boolean; reason: string } {
    const goal = this.repo.get(goalId)
    if (!goal) return { completed: false, reason: 'Goal not found' }
    if (goal.status === 'complete') return { completed: true, reason: 'Already complete' }

    const evaluation = this.evaluate(goalId)
    if (!evaluation.all_required_passed) {
      return { completed: false, reason: evaluation.evaluator_reason ?? 'Criteria not met' }
    }

    this.repo.update(goalId, {
      status: 'complete',
      time_used_seconds: this.freezeElapsed(goal),
      completed_at: new Date().toISOString(),
    })

    this.events.emit('GoalCompleted', {
      goal_id: goalId,
      objective: goal.objective,
      criteria_passed: evaluation.criteria_results.filter(r => r.status === 'passed').length,
    }, { goal_id: goalId })

    return { completed: true, reason: 'All criteria passed' }
  }

  /** Detect no-progress: compare consecutive evaluations. */
  detectNoProgress(goalId: string, previousHash: string): { stuck: boolean; current_hash: string } {
    const evaluation = this.evaluate(goalId)
    const currentHash = this.hashEvaluation(evaluation)
    return { stuck: currentHash === previousHash, current_hash: currentHash }
  }

  /** Block goal with reason. */
  block(goalId: string, reason: string): void {
    const goal = this.repo.get(goalId)
    if (!goal) throw new Error(`Goal '${goalId}' not found`)
    this.repo.update(goalId, {
      status: 'blocked',
      block_reason: reason,
      time_used_seconds: this.freezeElapsed(goal),
    })
    this.events.emit('GoalBlocked', { goal_id: goalId, reason }, { goal_id: goalId })
  }

  /** Pause goal. */
  pause(goalId: string): void {
    const goal = this.repo.get(goalId)
    if (!goal) throw new Error(`Goal '${goalId}' not found`)
    const now = new Date().toISOString()
    this.repo.update(goalId, {
      status: 'paused',
      paused_at: now,
      time_used_seconds: this.freezeElapsed(goal),
    })
    this.events.emit('GoalPaused', { goal_id: goalId }, { goal_id: goalId })
  }

  /** Resume goal. Starts a new active interval with a fresh started_at. */
  resume(goalId: string): void {
    const now = new Date().toISOString()
    this.repo.update(goalId, { status: 'active', resumed_at: now, started_at: now })
    this.events.emit('GoalResumed', { goal_id: goalId }, { goal_id: goalId })
  }

  /** Cancel goal. */
  cancel(goalId: string): void {
    const goal = this.repo.get(goalId)
    if (!goal) throw new Error(`Goal '${goalId}' not found`)
    this.repo.update(goalId, {
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      time_used_seconds: this.freezeElapsed(goal),
    })
    this.events.emit('GoalCancelled', { goal_id: goalId }, { goal_id: goalId })
  }

  /**
   * Compute elapsed active time for a GoalRow before it leaves 'active'.
   * Only adds wall-clock time since started_at when the status is active and
   * started_at is a valid timestamp.
   */
  private freezeElapsed(goal: GoalRow): number {
    if (goal.status !== 'active') return goal.time_used_seconds
    const started = Date.parse(goal.started_at)
    if (Number.isNaN(started)) return goal.time_used_seconds
    return goal.time_used_seconds + Math.max(0, Math.floor((Date.now() - started) / 1000))
  }

  private hashEvaluation(e: GoalEvaluation): string {
    return createHash('sha256').update(JSON.stringify(e.criteria_results)).digest('hex').slice(0, 16)
  }
}
