import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { validateTaskMessage } from './schema.js'
import type { TaskMessageType, TaskMessageV1 } from './types.js'

export class TaskMailbox {
  private readonly messages = new Map<string, TaskMessageV1>()

  send(input: {
    messageId?: string
    senderId: string
    recipientId: string
    type: TaskMessageType
    taskId: string
    correlationId?: string
    payload: Record<string, unknown>
  }): { message: TaskMessageV1; duplicate: boolean } {
    const messageId = input.messageId ?? randomUUID()
    const existing = this.messages.get(messageId)
    if (existing) {
      const same = existing.senderId === input.senderId && existing.recipientId === input.recipientId &&
        existing.taskId === input.taskId && existing.type === input.type && isDeepStrictEqual(existing.payload, input.payload)
      if (!same) throw new Error(`Task message ID collision for '${messageId}'`)
      return { message: structuredClone(existing), duplicate: true }
    }

    const message: TaskMessageV1 = {
      schemaVersion: 1,
      messageId,
      senderId: input.senderId,
      recipientId: input.recipientId,
      type: input.type,
      correlationId: input.correlationId ?? randomUUID(),
      taskId: input.taskId,
      timestamp: new Date().toISOString(),
      payload: structuredClone(input.payload),
      status: 'pending',
    }
    const validation = validateTaskMessage(message)
    if (!validation.valid) throw new Error(`Invalid task message: ${validation.errors.join('; ')}`)
    this.messages.set(messageId, message)
    return { message: structuredClone(message), duplicate: false }
  }

  acknowledge(messageId: string): boolean {
    const message = this.messages.get(messageId)
    if (!message) return false
    if (message.status === 'processed') return true
    message.status = 'processed'
    return true
  }

  restore(messages: TaskMessageV1[]): void {
    if (this.messages.size > 0) throw new Error('Mailbox can only be restored while empty')
    for (const message of messages) {
      const validation = validateTaskMessage(message)
      if (!validation.valid) throw new Error(`Invalid restored task message: ${validation.errors.join('; ')}`)
      if (this.messages.has(message.messageId)) throw new Error(`Duplicate restored message '${message.messageId}'`)
      this.messages.set(message.messageId, structuredClone(message))
    }
  }

  list(recipientId?: string, status?: TaskMessageV1['status']): TaskMessageV1[] {
    return [...this.messages.values()]
      .filter(message => !recipientId || message.recipientId === recipientId)
      .filter(message => !status || message.status === status)
      .map(message => structuredClone(message))
  }
}
