import type { Store } from '../store/store.js'
import { randomUUID } from 'node:crypto'

export interface EventEnvelope {
  event_id: string
  schema_version: number
  session_id: string
  thread_id?: string
  task_id?: string
  goal_id?: string
  correlation_id: string
  causation_id?: string
  type: string
  actor: string
  payload: Record<string, unknown>
  created_at: string
}

export type EventListener = (event: EventEnvelope) => void | Promise<void>

export interface EmitOptions {
  thread_id?: string
  task_id?: string
  goal_id?: string
  correlation_id?: string
  causation_id?: string
  actor?: string
}

export class EventBus {
  private readonly listeners = new Set<EventListener>()
  private readonly store: Store
  readonly sessionId: string

  constructor(store: Store, sessionId: string) {
    this.store = store
    this.sessionId = sessionId
  }

  /** Emit an event. Stores durably and notifies subscribers. */
  emit(type: string, payload: Record<string, unknown>, options: EmitOptions = {}): EventEnvelope {
    const event: EventEnvelope = {
      event_id: randomUUID(),
      schema_version: 1,
      session_id: this.sessionId,
      thread_id: options.thread_id,
      task_id: options.task_id,
      goal_id: options.goal_id,
      correlation_id: options.correlation_id ?? randomUUID(),
      causation_id: options.causation_id,
      type,
      actor: options.actor ?? 'system',
      payload,
      created_at: new Date().toISOString(),
    }

    this.store.run(
      `INSERT INTO events (event_id, schema_version, session_id, thread_id, task_id, goal_id,
        correlation_id, causation_id, type, actor, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      event.event_id, event.schema_version, event.session_id, event.thread_id ?? null,
      event.task_id ?? null, event.goal_id ?? null, event.correlation_id, event.causation_id ?? null,
      event.type, event.actor, JSON.stringify(event.payload), event.created_at,
    )

    for (const listener of this.listeners) {
      try { void listener(structuredClone(event)) } catch { /* observers cannot break the bus */ }
    }

    return event
  }

  /** Subscribe to all events. Returns unsubscribe function. */
  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Query events from the store. */
  query(filters: {
    type?: string
    task_id?: string
    thread_id?: string
    goal_id?: string
    after?: string
    limit?: number
  } = {}): EventEnvelope[] {
    const conditions: string[] = []
    const params: unknown[] = []

    conditions.push('session_id = ?')
    params.push(this.sessionId)

    if (filters.type) { conditions.push('type = ?'); params.push(filters.type) }
    if (filters.task_id) { conditions.push('task_id = ?'); params.push(filters.task_id) }
    if (filters.thread_id) { conditions.push('thread_id = ?'); params.push(filters.thread_id) }
    if (filters.goal_id) { conditions.push('goal_id = ?'); params.push(filters.goal_id) }
    if (filters.after) { conditions.push('created_at > ?'); params.push(filters.after) }

    const sql = `SELECT * FROM events WHERE ${conditions.join(' AND ')} ORDER BY created_at ASC LIMIT ${filters.limit ?? 1000}`
    const rows = this.store.query<Record<string, unknown>>(sql, ...params)
    return rows.map(row => ({
      ...row,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload as string) : row.payload,
    })) as EventEnvelope[]
  }

  /** Replay events deterministically (no side effects emitted to subscribers). */
  replay(filters: { type?: string; task_id?: string; thread_id?: string } = {}): EventEnvelope[] {
    // Replay is a read-only query — no listeners are called, no new events emitted.
    return this.query({ ...filters, limit: 10_000 })
  }

  /** Count events matching filters. */
  count(filters: { type?: string; task_id?: string } = {}): number {
    const conditions: string[] = ['session_id = ?']
    const params: unknown[] = [this.sessionId]
    if (filters.type) { conditions.push('type = ?'); params.push(filters.type) }
    if (filters.task_id) { conditions.push('task_id = ?'); params.push(filters.task_id) }
    const result = this.store.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM events WHERE ${conditions.join(' AND ')}`, ...params,
    )
    return result[0]?.count ?? 0
  }
}
