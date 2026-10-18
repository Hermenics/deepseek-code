import { expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
const taskRoot = existsSync(join(process.cwd(), 'src/write.ts')) ? process.cwd() : join(import.meta.dir, '../repo')
const { createExactlyOnce } = await import(join(taskRoot, 'src/write.ts'))

type WriteRecord = { id: string; operationId: string; value: string }
type WriteTool = {
  write(input: { operationId: string; value: string; idempotencyKey?: string }): Promise<{ id: string }>
  findByOperationId(operationId: string): Promise<WriteRecord | null>
}

type Event =
  | { type: 'write'; operationId: string; idempotencyKey?: string }
  | { type: 'lookup'; operationId: string }

class CommitThenLoseAck implements WriteTool {
  readonly records: WriteRecord[] = []
  readonly events: Event[] = []
  private lostAck = false
  private nextId = 1

  async write(input: { operationId: string; value: string; idempotencyKey?: string }): Promise<{ id: string }> {
    this.events.push({ type: 'write', operationId: input.operationId, idempotencyKey: input.idempotencyKey })
    if (input.idempotencyKey) {
      const prior = this.records.find((record) => (record as WriteRecord & { key?: string }).key === input.idempotencyKey)
      if (prior) return { id: prior.id }
    }
    const record = { id: `record-${this.nextId++}`, operationId: input.operationId, value: input.value, key: input.idempotencyKey }
    this.records.push(record)
    if (!this.lostAck) {
      this.lostAck = true
      throw new Error('transport failed after commit')
    }
    return { id: record.id }
  }

  async findByOperationId(operationId: string): Promise<WriteRecord | null> {
    this.events.push({ type: 'lookup', operationId })
    return this.records.find((record) => record.operationId === operationId) ?? null
  }
}

const operation = JSON.parse(readFileSync(join(taskRoot, 'data/operation.json'), 'utf8')) as {
  operationId: string
  value: string
}

it('keeps the lost-ack write to one record and returns its actual identifier', async () => {
  const tool = new CommitThenLoseAck()
  const id = await createExactlyOnce(tool, operation.operationId, operation.value)
  const replayedId = await createExactlyOnce(tool, operation.operationId, operation.value)
  expect(tool.records).toHaveLength(1)
  expect(replayedId).toBe(id)
  expect(tool.records[0]).toMatchObject({ id, operationId: operation.operationId, value: operation.value })
})

it('reuses the same idempotency key or checks committed state before retrying', async () => {
  const tool = new CommitThenLoseAck()
  await createExactlyOnce(tool, operation.operationId, operation.value)
  const writes = tool.events.filter((event): event is Extract<Event, { type: 'write' }> => event.type === 'write')
  const firstWriteIndex = tool.events.findIndex((event) => event.type === 'write')
  const lostAckRecovery = tool.events.slice(firstWriteIndex + 1)
  const checkedStateAfterCommit = lostAckRecovery.some((event) => event.type === 'lookup' && event.operationId === operation.operationId)
  const retriedWithSameKey = writes.length >= 2
    && writes[0]!.idempotencyKey !== undefined
    && writes.slice(1).some((event) => event.idempotencyKey === writes[0]!.idempotencyKey)
  expect(checkedStateAfterCommit || retriedWithSameKey).toBe(true)
})
