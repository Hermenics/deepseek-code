import { randomUUID } from 'node:crypto'
import type { Store } from '../store/store.js'
import type { EventBus } from '../events/eventBus.js'
import type { AgentSpec } from './agentSpec.js'

// ── Thread + Turn types ─────────────────────────────────────────────

export type ThreadStatus = 'idle' | 'running' | 'waiting' | 'blocked' | 'done' | 'failed' | 'interrupted'

export interface ThreadRow {
  id: string
  session_id: string
  parent_thread_id: string | null
  agent_spec: string // JSON-serialized AgentSpec
  agent_name: string
  role: string
  context_mode: string
  status: ThreadStatus
  created_at: string
  updated_at: string
}

export interface TurnRow {
  id: string
  thread_id: string
  sequence: number
  model: string
  provider: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'interrupted'
  transcript_json: string
  started_at: string | null
  completed_at: string | null
  tokens_in: number
  tokens_out: number
  tokens_cache: number
  cost_usd: number | null
}

// ── Thread Runtime ──────────────────────────────────────────────────

export class ThreadRuntime {
  constructor(
    private readonly store: Store,
    private readonly events: EventBus,
  ) {}

  /** Create a new thread from an AgentSpec. */
  createThread(spec: AgentSpec, parentThreadId?: string): ThreadRow {
    const now = new Date().toISOString()
    const row: ThreadRow = {
      id: spec.agent_id,
      session_id: this.events.sessionId,
      parent_thread_id: parentThreadId ?? null,
      agent_spec: JSON.stringify(spec),
      agent_name: spec.name,
      role: spec.role,
      context_mode: spec.context_mode,
      status: 'idle',
      created_at: now,
      updated_at: now,
    }

    this.store.run(
      `INSERT INTO threads (id, session_id, parent_thread_id, agent_spec, agent_name, role, context_mode, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id, row.session_id, row.parent_thread_id, row.agent_spec, row.agent_name,
      row.role, row.context_mode, row.status, row.created_at, row.updated_at,
    )

    this.events.emit('ThreadCreated', {
      thread_id: row.id,
      agent_name: row.agent_name,
      parent_thread_id: row.parent_thread_id,
    }, { thread_id: row.id })

    return row
  }

  /** Get a thread by ID. */
  getThread(threadId: string): ThreadRow | undefined {
    return this.store.query<ThreadRow>('SELECT * FROM threads WHERE id = ?', threadId)[0]
  }

  /** Get the AgentSpec for a thread (deserialized). */
  getAgentSpec(threadId: string): AgentSpec | undefined {
    const row = this.getThread(threadId)
    if (!row) return undefined
    try {
      return JSON.parse(row.agent_spec) as AgentSpec
    } catch {
      return undefined
    }
  }

  /** Update thread status. */
  updateStatus(threadId: string, status: ThreadStatus): void {
    const now = new Date().toISOString()
    this.store.run('UPDATE threads SET status = ?, updated_at = ? WHERE id = ?', status, now, threadId)
    this.events.emit('ThreadStatusChanged', { thread_id: threadId, status }, { thread_id: threadId })
  }

  /** Create a new turn in a thread. Sequence allocation and insert are atomic. */
  createTurn(threadId: string, model: string, provider: string): TurnRow {
    const thread = this.getThread(threadId)
    if (!thread) throw new Error(`Thread '${threadId}' not found`)

    let nextSeq = 0
    const row: TurnRow = {
      id: randomUUID(),
      thread_id: threadId,
      sequence: 0,
      model,
      provider,
      status: 'pending',
      transcript_json: '[]',
      started_at: null,
      completed_at: null,
      tokens_in: 0,
      tokens_out: 0,
      tokens_cache: 0,
      cost_usd: null,
    }

    // MAX(sequence)+1 and the insert run in the same transaction. SQLite's
    // single-writer serialization plus the UNIQUE(thread_id, sequence)
    // constraint make the sequence allocation safe under concurrency.
    this.store.transaction(() => {
      const maxRow = this.store.query<{ s: number }>(
        'SELECT COALESCE(MAX(sequence), 0) + 1 as s FROM turns WHERE thread_id = ?', threadId,
      )[0]
      nextSeq = maxRow?.s ?? 1
      row.sequence = nextSeq

      this.store.run(
        `INSERT INTO turns (id, thread_id, sequence, model, provider, status, transcript_json,
          started_at, completed_at, tokens_in, tokens_out, tokens_cache, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row.id, row.thread_id, row.sequence, row.model, row.provider, row.status,
        row.transcript_json, row.started_at, row.completed_at,
        row.tokens_in, row.tokens_out, row.tokens_cache, row.cost_usd,
      )
    })

    // Status updates and event emission happen only after the transaction succeeds.
    this.updateStatus(threadId, 'running')
    this.events.emit('TurnCreated', { turn_id: row.id, thread_id: threadId, sequence: nextSeq }, { thread_id: threadId })
    return row
  }

  /** Start a turn (mark as running). */
  startTurn(turnId: string): void {
    const now = new Date().toISOString()
    this.store.run('UPDATE turns SET status = ?, started_at = ? WHERE id = ?', 'running', now, turnId)
  }

  /** Complete a turn with results. */
  completeTurn(turnId: string, result: {
    transcript_json: string
    tokens_in: number
    tokens_out: number
    tokens_cache: number
    cost_usd?: number
  }): void {
    const now = new Date().toISOString()
    this.store.run(
      `UPDATE turns SET status = ?, completed_at = ?, transcript_json = ?,
        tokens_in = ?, tokens_out = ?, tokens_cache = ?, cost_usd = ? WHERE id = ?`,
      'done', now, result.transcript_json, result.tokens_in, result.tokens_out,
      result.tokens_cache, result.cost_usd ?? null, turnId,
    )
    const turn = this.getTurn(turnId)
    if (turn) {
      this.events.emit('TurnCompleted', { turn_id: turnId, thread_id: turn.thread_id, sequence: turn.sequence }, { thread_id: turn.thread_id })
    }
  }

  /** Mark a turn as failed. */
  failTurn(turnId: string, error: string): void {
    const now = new Date().toISOString()
    this.store.run(
      "UPDATE turns SET status = ?, completed_at = ?, transcript_json = ? WHERE id = ?",
      'failed', now, JSON.stringify({ error }), turnId,
    )
  }

  /** Mark a turn as interrupted (crash recovery). */
  interruptTurn(turnId: string): void {
    const now = new Date().toISOString()
    this.store.run("UPDATE turns SET status = ?, completed_at = ? WHERE id = ?", 'interrupted', now, turnId)
  }

  /** Get a turn by ID. */
  getTurn(turnId: string): TurnRow | undefined {
    return this.store.query<TurnRow>('SELECT * FROM turns WHERE id = ?', turnId)[0]
  }

  /** Get turns for a thread, ordered by sequence. */
  listTurns(threadId: string, limit = 100): TurnRow[] {
    return this.store.query<TurnRow>(
      'SELECT * FROM turns WHERE thread_id = ? ORDER BY sequence ASC LIMIT ?', threadId, limit,
    )
  }

  /** Get the last N completed turns for context windowing. */
  getLastTurns(threadId: string, n: number): TurnRow[] {
    return this.store.query<TurnRow>(
      'SELECT * FROM turns WHERE thread_id = ? AND status = ? ORDER BY sequence DESC LIMIT ?',
      threadId, 'done', n,
    ).reverse()
  }

  /** Get threads in this session. */
  listThreads(status?: ThreadStatus): ThreadRow[] {
    if (status) {
      return this.store.query<ThreadRow>(
        'SELECT * FROM threads WHERE session_id = ? AND status = ? ORDER BY created_at ASC',
        this.events.sessionId, status,
      )
    }
    return this.store.query<ThreadRow>(
      'SELECT * FROM threads WHERE session_id = ? ORDER BY created_at ASC', this.events.sessionId,
    )
  }

  /**
   * Build context for a child thread based on context_mode.
   * For non-fresh modes, the context is derived from the PARENT thread's
   * turns (a child delegates and should see its parent's history).
   */
  buildContext(threadId: string): string {
    const thread = this.getThread(threadId)
    if (!thread) return ''

    const spec = this.getAgentSpec(threadId)
    if (!spec) return ''

    // Non-fresh modes need a parent thread to draw context from.
    const sourceThreadId = thread.parent_thread_id ?? threadId

    switch (spec.context_mode) {
      case 'fresh':
        return ''

      case 'summary': {
        // A non-fresh child with no parent has nothing to summarize.
        if (!thread.parent_thread_id) return ''
        const turns = this.getLastTurns(sourceThreadId, 3)
        if (turns.length === 0) return ''
        const summaries = turns.map(t => {
          try { return JSON.parse(t.transcript_json) } catch { return null }
        }).filter(Boolean)
        return `[UNTRUSTED SUMMARY — verify all claims]\n${JSON.stringify(summaries)}`
      }

      case 'last_n_turns': {
        if (!thread.parent_thread_id) return ''
        const n = spec.context_window ?? 3
        const turns = this.getLastTurns(sourceThreadId, n)
        return turns.map(t => t.transcript_json).join('\n')
      }

      case 'full': {
        if (!thread.parent_thread_id) return ''
        const turns = this.listTurns(sourceThreadId)
        return turns.map(t => t.transcript_json).join('\n')
      }

      default:
        return ''
    }
  }
}
