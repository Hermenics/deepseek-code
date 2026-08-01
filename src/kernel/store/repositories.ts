import type { Store } from './store.js'
import type { EventBus } from '../events/eventBus.js'
import { randomUUID } from 'node:crypto'

// ── Session Repository ──────────────────────────────────────────────

export interface SessionRow {
  id: string
  title: string | null
  cwd: string
  model: string
  provider: string
  language: string | null
  active_agent: string | null
  created_at: string
  updated_at: string
}

export class SessionRepo {
  constructor(
    private readonly store: Store,
    private readonly events: EventBus,
  ) {}

  create(session: Omit<SessionRow, 'created_at' | 'updated_at'>): SessionRow {
    const now = new Date().toISOString()
    const row: SessionRow = { ...session, created_at: now, updated_at: now }
    this.store.run(
      `INSERT INTO sessions (id, title, cwd, model, provider, language, active_agent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id, row.title, row.cwd, row.model, row.provider,
      row.language, row.active_agent, row.created_at, row.updated_at,
    )
    this.events.emit('SessionCreated', { id: row.id, cwd: row.cwd }, { thread_id: row.id })
    return row
  }

  get(id: string): SessionRow | undefined {
    const rows = this.store.query<SessionRow>('SELECT * FROM sessions WHERE id = ?', id)
    return rows[0]
  }

  update(id: string, fields: Partial<Pick<SessionRow, 'title' | 'model' | 'provider' | 'language' | 'active_agent'>>): void {
    const now = new Date().toISOString()
    const sets: string[] = ['updated_at = ?']
    const params: unknown[] = [now]
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        sets.push(`${key} = ?`)
        params.push(value)
      }
    }
    params.push(id)
    this.store.run(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`, ...params)
  }

  delete(id: string): void {
    this.store.run('DELETE FROM sessions WHERE id = ?', id)
  }

  list(limit = 50): SessionRow[] {
    return this.store.query<SessionRow>('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?', limit)
  }
}

// ── Goal Repository ─────────────────────────────────────────────────

export type GoalStatus = 'draft' | 'active' | 'evaluating' | 'paused' | 'blocked' | 'budget_limited' | 'usage_limited' | 'complete' | 'failed' | 'cancelled'

export interface GoalRow {
  goal_id: string
  thread_id: string
  session_id: string
  revision: number
  objective: string
  status: GoalStatus
  token_budget: number | null
  max_continuations: number
  tokens_used: number
  time_used_seconds: number
  continuations: number
  consecutive_blocks: number
  block_reason: string | null
  started_at: string
  created_at: string
  updated_at: string
  paused_at: string | null
  resumed_at: string | null
  completed_at: string | null
  cancelled_at: string | null
}

export interface GoalCriteriaRow {
  id: string
  goal_id: string
  sequence: number
  kind: 'command' | 'test' | 'artifact' | 'evaluator' | 'human'
  spec: string
  required: number
  status: 'pending' | 'passed' | 'failed'
  result: string | null
  evaluated_at: string | null
}

const GOAL_COLUMNS = [
  'goal_id', 'thread_id', 'session_id', 'revision', 'objective', 'status',
  'token_budget', 'max_continuations', 'tokens_used', 'time_used_seconds',
  'continuations', 'consecutive_blocks', 'block_reason', 'started_at',
  'created_at', 'updated_at', 'paused_at', 'resumed_at', 'completed_at', 'cancelled_at',
].join(', ')

export class GoalRepo {
  constructor(
    private readonly store: Store,
    private readonly events: EventBus,
  ) {}

  create(input: {
    goal_id?: string
    thread_id: string
    objective: string
    token_budget?: number
    max_continuations?: number
  }): GoalRow {
    const now = new Date().toISOString()
    const row: GoalRow = {
      goal_id: input.goal_id ?? randomUUID(),
      thread_id: input.thread_id,
      session_id: this.events.sessionId,
      revision: 1,
      objective: input.objective,
      status: 'active',
      token_budget: input.token_budget ?? null,
      max_continuations: input.max_continuations ?? 3,
      tokens_used: 0,
      time_used_seconds: 0,
      continuations: 0,
      consecutive_blocks: 0,
      block_reason: null,
      started_at: now,
      created_at: now,
      updated_at: now,
      paused_at: null,
      resumed_at: null,
      completed_at: null,
      cancelled_at: null,
    }

    this.store.run(
      `INSERT INTO goals (${GOAL_COLUMNS}) VALUES (${Array(GOAL_COLUMNS.split(',').length).fill('?').join(', ')})`,
      row.goal_id, row.thread_id, row.session_id, row.revision, row.objective, row.status,
      row.token_budget, row.max_continuations, row.tokens_used, row.time_used_seconds,
      row.continuations, row.consecutive_blocks, row.block_reason, row.started_at,
      row.created_at, row.updated_at, row.paused_at, row.resumed_at, row.completed_at, row.cancelled_at,
    )

    this.events.emit('GoalCreated', { goal_id: row.goal_id, objective: row.objective }, { goal_id: row.goal_id, thread_id: row.thread_id })
    return row
  }

  get(goalId: string): GoalRow | undefined {
    return this.store.query<GoalRow>('SELECT * FROM goals WHERE goal_id = ?', goalId)[0]
  }

  getActive(threadId: string): GoalRow | undefined {
    return this.store.query<GoalRow>(
      `SELECT * FROM goals WHERE session_id = ? AND thread_id = ?
        AND status NOT IN ('complete', 'failed', 'cancelled')
        ORDER BY created_at DESC LIMIT 1`,
      this.events.sessionId, threadId,
    )[0]
  }

  /**
   * Concurrency-safe update. Reads the current goal, merges fields, increments
   * revision, and writes inside one transaction guarded by a revision check.
   * Throws on a concurrent-write conflict (zero rows updated).
   */
  update(goalId: string, fields: Partial<Omit<GoalRow, 'goal_id' | 'session_id' | 'created_at'>>): void {
    const now = new Date().toISOString()

    let updated = false
    this.store.transaction(() => {
      const current = this.get(goalId)
      if (!current) throw new Error(`Goal '${goalId}' not found`)

      const merged = { ...current, ...fields, revision: current.revision + 1, updated_at: now }
      const changes = this.store.run(
        `UPDATE goals SET revision = ?, objective = ?, status = ?, token_budget = ?, max_continuations = ?,
          tokens_used = ?, time_used_seconds = ?, continuations = ?, consecutive_blocks = ?,
          block_reason = ?, started_at = ?, updated_at = ?, paused_at = ?, resumed_at = ?,
          completed_at = ?, cancelled_at = ? WHERE goal_id = ? AND revision = ?`,
        merged.revision, merged.objective, merged.status, merged.token_budget,
        merged.max_continuations, merged.tokens_used, merged.time_used_seconds,
        merged.continuations, merged.consecutive_blocks, merged.block_reason,
        merged.started_at, merged.updated_at, merged.paused_at, merged.resumed_at,
        merged.completed_at, merged.cancelled_at, goalId, current.revision,
      )
      updated = changes > 0
    })

    if (!updated) {
      throw new Error(`Concurrent write conflict while updating goal '${goalId}'`)
    }

    const merged = this.get(goalId)!
    this.events.emit('GoalUpdated', { goal_id: goalId, status: merged.status }, { goal_id: goalId, thread_id: merged.thread_id })
  }

  addCriteria(input: Omit<GoalCriteriaRow, 'id' | 'status' | 'result' | 'evaluated_at'>): GoalCriteriaRow {
    const row: GoalCriteriaRow = {
      ...input,
      id: randomUUID(),
      status: 'pending',
      result: null,
      evaluated_at: null,
    }
    this.store.run(
      'INSERT INTO goal_criteria (id, goal_id, sequence, kind, spec, required, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      row.id, row.goal_id, row.sequence, row.kind, row.spec, row.required, row.status,
    )
    return row
  }

  listCriteria(goalId: string): GoalCriteriaRow[] {
    return this.store.query<GoalCriteriaRow>('SELECT * FROM goal_criteria WHERE goal_id = ? ORDER BY sequence', goalId)
  }

  updateCriteria(id: string, fields: { status: 'passed' | 'failed'; result?: string }): void {
    const now = new Date().toISOString()
    this.store.run(
      'UPDATE goal_criteria SET status = ?, result = ?, evaluated_at = ? WHERE id = ?',
      fields.status, fields.result ?? null, now, id,
    )
  }

  list(options: { thread_id?: string; status?: GoalStatus; limit?: number } = {}): GoalRow[] {
    const conditions: string[] = ['session_id = ?']
    const params: unknown[] = [this.events.sessionId]
    if (options.thread_id) { conditions.push('thread_id = ?'); params.push(options.thread_id) }
    if (options.status) { conditions.push('status = ?'); params.push(options.status) }
    return this.store.query<GoalRow>(
      `SELECT * FROM goals WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ?`,
      ...params, options.limit ?? 50,
    )
  }
}
