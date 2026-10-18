import { expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createExactlyOnce, type WriteRecord, type WriteTool } from '../src/write'

const operation = JSON.parse(readFileSync(join(import.meta.dir, '../data/operation.json'), 'utf8')) as {
  operationId: string
  value: string
}

it('returns the committed record after the first acknowledgment is lost', async () => {
  const records: WriteRecord[] = []
  let first = true
  const tool: WriteTool = {
    async write(input) {
      const existing = input.idempotencyKey
        ? records.find((record) => record.operationId === input.operationId)
        : undefined
      if (existing) return { id: existing.id }
      const record = { id: `record-${records.length + 1}`, operationId: input.operationId, value: input.value }
      records.push(record)
      if (first) {
        first = false
        throw new Error('transport failed after commit')
      }
      return { id: record.id }
    },
    async findByOperationId(operationId) {
      return records.find((record) => record.operationId === operationId) ?? null
    },
  }
  const id = await createExactlyOnce(tool, operation.operationId, operation.value)
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({ id, operationId: operation.operationId, value: operation.value })
})
