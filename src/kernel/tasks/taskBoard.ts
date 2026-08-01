import { randomUUID } from 'node:crypto'
import type { Store } from '../store/store.js'
import type { EventBus } from '../events/eventBus.js'

// ── Types ───────────────────────────────────────────────────────────

export type TaskState = 'queued' | 'running' | 'blocked' | 'done' | 'failed' | 'cancelled' | 'timed_out'

const TERMINAL_TASK_STATES = new Set<TaskState>(['done', 'failed', 'cancelled', 'timed_out'])

/** Allowed state transitions for the task model. */
export const ALLOWED_TASK_TRANSITIONS: Record<TaskState, ReadonlyArray<TaskState>> = {
  queued: ['running', 'blocked', 'cancelled'],
  running: ['done', 'failed', 'blocked', 'cancelled', 'timed_out'],
  blocked: ['queued', 'failed', 'cancelled'],
  done: [],
  failed: ['queued'],
  cancelled: ['queued'],
  timed_out: ['queued'],
}

export interface TaskRow {
  task_id: string
  session_id: string
  parent_task_id: string | null
  type: string
  mode: string
  context_mode: string
  state: TaskState
  depth: number
  attempt: number
  permission_profile: string
  max_tokens: number | null
  max_cost_usd: number | null
  timeout_ms: number
  block_reason: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  error_code: string | null
  error_message: string | null
  tokens_used: number
  cost_usd: number | null
  latency_ms: number | null
  metadata: string
}

export interface LeaseRow {
  lease_id: string
  task_id: string
  holder_id: string
  resource_path: string
  acquired_at: string
  expires_at: string
  heartbeat_at: string
  released_at: string | null
  status: 'active' | 'expired' | 'released'
}

const TASK_COLUMNS = [
  'task_id', 'session_id', 'parent_task_id', 'type', 'mode', 'context_mode',
  'state', 'depth', 'attempt', 'permission_profile', 'max_tokens', 'max_cost_usd',
  'timeout_ms', 'block_reason', 'created_at', 'started_at', 'completed_at',
  'error_code', 'error_message', 'tokens_used', 'cost_usd', 'latency_ms', 'metadata',
].join(', ')

// ── Task Board ──────────────────────────────────────────────────────

export class TaskBoard {
  constructor(
    private readonly store: Store,
    private readonly events: EventBus,
  ) {}

  create(input: {
    task_id?: string
    parent_task_id?: string
    type?: string
    mode?: string
    context_mode?: string
    depth?: number
    timeout_ms?: number
    permission_profile?: string
    max_tokens?: number
    max_cost_usd?: number
    metadata?: Record<string, unknown>
  }): TaskRow {
    const now = new Date().toISOString()
    const row: TaskRow = {
      task_id: input.task_id ?? randomUUID(),
      session_id: this.events.sessionId,
      parent_task_id: input.parent_task_id ?? null,
      type: input.type ?? 'agent',
      mode: input.mode ?? 'foreground',
      context_mode: input.context_mode ?? 'fresh',
      state: 'queued',
      depth: input.depth ?? 0,
      attempt: 0,
      permission_profile: input.permission_profile ?? 'researcher-readonly',
      max_tokens: input.max_tokens ?? null,
      max_cost_usd: input.max_cost_usd ?? null,
      timeout_ms: input.timeout_ms ?? 120_000,
      block_reason: null,
      created_at: now,
      started_at: null,
      completed_at: null,
      error_code: null,
      error_message: null,
      tokens_used: 0,
      cost_usd: null,
      latency_ms: null,
      metadata: JSON.stringify(input.metadata ?? {}),
    }

    this.store.run(
      `INSERT INTO tasks (${TASK_COLUMNS}) VALUES (${Array(TASK_COLUMNS.split(',').length).fill('?').join(', ')})`,
      row.task_id, row.session_id, row.parent_task_id, row.type, row.mode, row.context_mode,
      row.state, row.depth, row.attempt, row.permission_profile, row.max_tokens, row.max_cost_usd,
      row.timeout_ms, row.block_reason, row.created_at, row.started_at, row.completed_at,
      row.error_code, row.error_message, row.tokens_used, row.cost_usd, row.latency_ms, row.metadata,
    )

    this.events.emit('TaskCreated', { task_id: row.task_id, type: row.type, parent_task_id: row.parent_task_id }, { task_id: row.task_id })
    return row
  }

  get(taskId: string): TaskRow | undefined {
    return this.store.query<TaskRow>('SELECT * FROM tasks WHERE task_id = ?', taskId)[0]
  }

  transition(taskId: string, to: TaskState, extra: Partial<Pick<TaskRow, 'block_reason' | 'error_code' | 'error_message' | 'tokens_used' | 'cost_usd' | 'latency_ms'>> = {}): void {
    const now = new Date().toISOString()
    const current = this.get(taskId)
    if (!current) throw new Error(`Task '${taskId}' not found`)

    if (current.state === to) {
      // No-op transition: preserve state and history unchanged.
      return
    }

    const allowed = ALLOWED_TASK_TRANSITIONS[current.state]
    if (!allowed.includes(to)) {
      throw new Error(`Invalid task transition for '${taskId}': ${current.state} -> ${to}`)
    }

    // completed_at rules:
    // - Entering a terminal state sets completed_at to now.
    // - A valid terminal -> queued transition (resume/retry) clears completed_at
    //   AND starts a new attempt.
    // - Non-terminal -> non-terminal updates preserve any existing completed_at.
    const toTerminal = TERMINAL_TASK_STATES.has(to)
    const fromTerminal = TERMINAL_TASK_STATES.has(current.state)
    const completedAt = toTerminal
      ? now
      : (fromTerminal && to === 'queued' ? null : current.completed_at)
    const attempt = (fromTerminal && to === 'queued') ? current.attempt + 1 : current.attempt
    const startedAt = (fromTerminal && to === 'queued') ? null : (to === 'running' ? now : current.started_at)

    this.store.run(
      `UPDATE tasks SET state = ?, started_at = ?, completed_at = ?,
        block_reason = ?, error_code = ?, error_message = ?,
        tokens_used = ?, cost_usd = ?, latency_ms = ?, attempt = ? WHERE task_id = ?`,
      to, startedAt, completedAt,
      extra.block_reason ?? current.block_reason,
      extra.error_code ?? current.error_code,
      extra.error_message ?? current.error_message,
      extra.tokens_used ?? current.tokens_used,
      extra.cost_usd ?? current.cost_usd,
      extra.latency_ms ?? current.latency_ms,
      attempt, taskId,
    )

    this.events.emit('TaskStateChanged', { task_id: taskId, from: current.state, to }, { task_id: taskId })
  }

  list(filter?: { state?: TaskState; parent_task_id?: string }): TaskRow[] {
    const conditions: string[] = ['session_id = ?']
    const params: unknown[] = [this.events.sessionId]
    if (filter?.state) { conditions.push('state = ?'); params.push(filter.state) }
    if (filter?.parent_task_id !== undefined) {
      if (filter.parent_task_id === null) conditions.push('parent_task_id IS NULL')
      else { conditions.push('parent_task_id = ?'); params.push(filter.parent_task_id) }
    }
    return this.store.query<TaskRow>(
      `SELECT * FROM tasks WHERE ${conditions.join(' AND ')} ORDER BY created_at ASC`, ...params,
    )
  }

  /** Get tasks ready to be claimed (queued, dependencies met). */
  listReady(): TaskRow[] {
    const queued = this.list({ state: 'queued' })
    return queued.filter(t => !this.hasPendingDeps(t.task_id))
  }

  private hasPendingDeps(taskId: string): boolean {
    const deps = this.store.query<{ dependency_id: string }>(
      'SELECT dependency_id FROM task_dependencies WHERE task_id = ?', taskId,
    )
    for (const dep of deps) {
      const d = this.get(dep.dependency_id)
      if (d && d.state !== 'done') return true
    }
    return false
  }

  addDependency(taskId: string, dependencyId: string): void {
    this.store.run(
      'INSERT OR IGNORE INTO task_dependencies (task_id, dependency_id) VALUES (?, ?)',
      taskId, dependencyId,
    )
  }
}

// ── Lease Manager ───────────────────────────────────────────────────

const LEASE_DURATION_MS = 30_000  // 30s default
const LEASE_HEARTBEAT_MS = 10_000 // heartbeat every 10s

export class LeaseManager {
  constructor(
    private readonly store: Store,
    private readonly events: EventBus,
  ) {}

  /** Acquire a lease on a resource. Returns null if already leased. */
  acquire(taskId: string, holderId: string, resourcePath: string, durationMs = LEASE_DURATION_MS): LeaseRow | null {
    const now = new Date().toISOString()
    const expires = new Date(Date.now() + durationMs).toISOString()
    const row: LeaseRow = {
      lease_id: randomUUID(),
      task_id: taskId,
      holder_id: holderId,
      resource_path: resourcePath,
      acquired_at: now,
      expires_at: expires,
      heartbeat_at: now,
      released_at: null,
      status: 'active',
    }

    // Lookup + insert happen in one transaction. The partial unique index on
    // (resource_path) WHERE status='active' makes concurrent acquisition safe:
    // INSERT OR IGNORE silently no-ops on a uniqueness conflict, and the 0
    // changed-row count is the failed-acquisition signal.
    let inserted = false
    this.store.transaction(() => {
      // Expire stale leases before attempting acquisition.
      this.store.run("UPDATE leases SET status = 'expired' WHERE status = 'active' AND expires_at < ?", now)
      const changes = this.store.run(
        `INSERT OR IGNORE INTO leases (lease_id, task_id, holder_id, resource_path, acquired_at, expires_at, heartbeat_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        row.lease_id, row.task_id, row.holder_id, row.resource_path,
        row.acquired_at, row.expires_at, row.heartbeat_at, row.status,
      )
      inserted = changes > 0
    })

    if (!inserted) return null

    this.events.emit('LeaseAcquired', { lease_id: row.lease_id, task_id: taskId, resource: resourcePath }, { task_id: taskId })
    return row
  }

  /** Heartbeat a lease to extend it. Returns true only if an active lease row changed. */
  heartbeat(leaseId: string, durationMs = LEASE_DURATION_MS): boolean {
    const now = new Date().toISOString()
    const expires = new Date(Date.now() + durationMs).toISOString()
    const changes = this.store.run(
      "UPDATE leases SET heartbeat_at = ?, expires_at = ? WHERE lease_id = ? AND status = 'active'",
      now, expires, leaseId,
    )
    return changes > 0
  }

  /** Release a lease. */
  release(leaseId: string): void {
    const now = new Date().toISOString()
    this.store.run("UPDATE leases SET status = 'released', released_at = ? WHERE lease_id = ?", now, leaseId)
    this.events.emit('LeaseReleased', { lease_id: leaseId }, {})
  }

  /** Find active lease for a resource. */
  private findActive(resourcePath: string): LeaseRow | undefined {
    const now = new Date().toISOString()
    // Expire stale leases first
    this.store.run("UPDATE leases SET status = 'expired' WHERE status = 'active' AND expires_at < ?", now)

    return this.store.query<LeaseRow>(
      "SELECT * FROM leases WHERE resource_path = ? AND status = 'active' ORDER BY acquired_at DESC LIMIT 1",
      resourcePath,
    )[0]
  }

  /** Check if a task holds any active leases. */
  hasLease(taskId: string, resourcePath?: string): boolean {
    if (resourcePath) {
      return this.findActive(resourcePath)?.task_id === taskId
    }
    const rows = this.store.query<LeaseRow>(
      "SELECT * FROM leases WHERE task_id = ? AND status = 'active'", taskId,
    )
    return rows.length > 0
  }

  /** Get all leases for a task. */
  listLeases(taskId: string): LeaseRow[] {
    return this.store.query<LeaseRow>('SELECT * FROM leases WHERE task_id = ? ORDER BY acquired_at ASC', taskId)
  }

  /** Expire all leases for a task (called on task completion/failure). */
  releaseAll(taskId: string): void {
    const now = new Date().toISOString()
    this.store.run("UPDATE leases SET status = 'released', released_at = ? WHERE task_id = ? AND status = 'active'", now, taskId)
  }
}

// The leases table schema lives in src/kernel/store/migrations.ts as
// migration v2 (single migration source). No schema is declared here.
