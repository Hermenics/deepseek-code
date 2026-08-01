import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { Store } from '../store/store.js'
import type { EventBus } from '../events/eventBus.js'

// ── Message Types ───────────────────────────────────────────────────

export type MessageType =
  | 'direct' | 'broadcast' | 'progress' | 'result'
  | 'question' | 'permission' | 'resource' | 'conflict'
  | 'cancel' | 'followup'

export interface AgentMessage {
  message_id: string
  sender_id: string
  recipient_id: string
  task_id: string
  type: MessageType
  correlation_id: string
  payload: Record<string, unknown>
  status: 'pending' | 'processed'
  created_at: string
}

// ── Message Router ──────────────────────────────────────────────────

export class MessageRouter {
  private readonly pendingDeliveries = new Map<string, AgentMessage>()

  constructor(
    private readonly store: Store,
    private readonly events: EventBus,
  ) {}

  /** Send a message from one agent to another. Deduplicates by message_id. */
  send(input: {
    message_id?: string
    sender_id: string
    recipient_id: string
    task_id: string
    type: MessageType
    correlation_id?: string
    payload: Record<string, unknown>
  }): { message: AgentMessage; duplicate: boolean } {
    const messageId = input.message_id ?? randomUUID()

    // Check for duplicate
    const existing = this.store.query<AgentMessage>(
      'SELECT * FROM messages WHERE message_id = ?', messageId,
    )[0]

    if (existing) {
      const same = existing.sender_id === input.sender_id &&
        existing.recipient_id === input.recipient_id &&
        existing.task_id === input.task_id &&
        existing.type === input.type &&
        isDeepStrictEqual(
          typeof existing.payload === 'string' ? JSON.parse(existing.payload as string) : existing.payload,
          input.payload,
        )

      if (!same) throw new Error(`Message ID collision: '${messageId}' with different content`)
      return { message: { ...existing, payload: parsePayload(existing.payload) }, duplicate: true }
    }

    const now = new Date().toISOString()
    const message: AgentMessage = {
      message_id: messageId,
      sender_id: input.sender_id,
      recipient_id: input.recipient_id,
      task_id: input.task_id,
      type: input.type,
      correlation_id: input.correlation_id ?? randomUUID(),
      payload: structuredClone(input.payload),
      status: 'pending',
      created_at: now,
    }

    this.store.run(
      `INSERT INTO messages (message_id, sender_id, recipient_id, task_id, type, correlation_id, payload, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      message.message_id, message.sender_id, message.recipient_id, message.task_id,
      message.type, message.correlation_id, JSON.stringify(message.payload),
      message.status, message.created_at,
    )

    this.pendingDeliveries.set(messageId, message)
    this.events.emit('AgentMessage', {
      message_id: messageId,
      sender_id: message.sender_id,
      recipient_id: message.recipient_id,
      type: message.type,
    }, { task_id: message.task_id })

    return { message, duplicate: false }
  }

  /** Broadcast a message to all agents in a task group. */
  broadcast(input: {
    sender_id: string
    task_id: string
    type: MessageType
    payload: Record<string, unknown>
    exclude_sender?: boolean
  }): AgentMessage[] {
    // Get all sibling tasks (same parent or root)
    const task = this.store.query<{ parent_task_id: string | null }>(
      'SELECT parent_task_id FROM tasks WHERE task_id = ?', input.task_id,
    )[0]

    const parentId = task?.parent_task_id ?? null
    // Bind SQL parameters separately per branch: the parent branch uses two
    // placeholders, the root branch uses exactly one.
    const siblings = parentId
      ? this.store.query<{ task_id: string }>(
          'SELECT task_id FROM tasks WHERE parent_task_id = ? AND task_id != ?',
          parentId, input.task_id,
        )
      : this.store.query<{ task_id: string }>(
          'SELECT task_id FROM tasks WHERE parent_task_id IS NULL AND task_id != ?',
          input.task_id,
        )

    const results: AgentMessage[] = []
    for (const sib of siblings) {
      const msg = this.send({
        sender_id: input.sender_id,
        recipient_id: sib.task_id,
        task_id: input.task_id,
        type: input.type,
        payload: input.payload,
      })
      results.push(msg.message)
    }
    return results
  }

  /** Acknowledge a message as processed. Idempotent. */
  acknowledge(messageId: string): boolean {
    const msg = this.store.query<AgentMessage>('SELECT * FROM messages WHERE message_id = ?', messageId)[0]
    if (!msg) return false
    if (msg.status === 'processed') return true

    this.store.run("UPDATE messages SET status = 'processed' WHERE message_id = ?", messageId)
    this.pendingDeliveries.delete(messageId)
    return true
  }

  /** Get pending messages for a recipient. */
  listPending(recipientId: string): AgentMessage[] {
    const rows = this.store.query<{ payload: string; [key: string]: unknown }>(
      "SELECT * FROM messages WHERE recipient_id = ? AND status = 'pending' ORDER BY created_at ASC",
      recipientId,
    )
    return rows.map(row => ({ ...row, payload: parsePayload(row.payload) })) as unknown as AgentMessage[]
  }

  /** Get all messages for a task. */
  listForTask(taskId: string): AgentMessage[] {
    const rows = this.store.query<{ payload: string; [key: string]: unknown }>(
      'SELECT * FROM messages WHERE task_id = ? ORDER BY created_at ASC', taskId,
    )
    return rows.map(row => ({ ...row, payload: parsePayload(row.payload) })) as unknown as AgentMessage[]
  }

  /** Get conversation between two agents. */
  listConversation(agentA: string, agentB: string): AgentMessage[] {
    const rows = this.store.query<{ payload: string; [key: string]: unknown }>(
      `SELECT * FROM messages WHERE
        (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
       ORDER BY created_at ASC`,
      agentA, agentB, agentB, agentA,
    )
    return rows.map(row => ({ ...row, payload: parsePayload(row.payload) })) as unknown as AgentMessage[]
  }

  /** Followup — deliver message AND start/resume a turn for the recipient. */
  followup(input: {
    sender_id: string
    recipient_id: string
    task_id: string
    payload: Record<string, unknown>
  }): AgentMessage {
    const result = this.send({
      ...input,
      type: 'followup',
    })
    this.events.emit('AgentFollowup', {
      message_id: result.message.message_id,
      recipient_id: input.recipient_id,
    }, { task_id: input.task_id })
    return result.message
  }

  /** Deliver all pending messages to their recipients via event. */
  flush(): void {
    for (const [id, msg] of this.pendingDeliveries) {
      this.events.emit('MessageDelivered', {
        message_id: msg.message_id,
        recipient_id: msg.recipient_id,
        type: msg.type,
      }, { task_id: msg.task_id })
    }
    this.pendingDeliveries.clear()
  }
}

function parsePayload(payload: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof payload === 'string') {
    try { return JSON.parse(payload) } catch { return { raw: payload } }
  }
  return payload
}
