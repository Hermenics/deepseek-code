import { afterEach, expect, it } from 'bun:test'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runIsolatedChecker } from '../scripts/eval/checker.js'
import { sandboxAvailable } from '../src/utils/platform.js'

const scratch: string[] = []
const sandboxTest = it.skipIf(!sandboxAvailable())
const checkerSource = join(import.meta.dir, '../scripts/eval/tasks/retry-idempotent-write/check')
const reference = `type WriteTool = {
  write(input: { operationId: string; value: string; idempotencyKey?: string }): Promise<{ id: string }>
  findByOperationId(operationId: string): Promise<{ id: string } | null>
}

export async function createExactlyOnce(tool: WriteTool, operationId: string, value: string): Promise<string> {
  const idempotencyKey = operationId
  try {
    return (await tool.write({ operationId, value, idempotencyKey })).id
  } catch {
    const committed = await tool.findByOperationId(operationId)
    if (committed) return committed.id
    return (await tool.write({ operationId, value, idempotencyKey })).id
  }
}
`
const replayDuplicates = `type WriteTool = {
  write(input: { operationId: string; value: string; idempotencyKey?: string }): Promise<{ id: string }>
  findByOperationId(operationId: string): Promise<{ id: string } | null>
}

export async function createExactlyOnce(tool: WriteTool, operationId: string, value: string): Promise<string> {
  try {
    return (await tool.write({ operationId, value })).id
  } catch {
    const committed = await tool.findByOperationId(operationId)
    if (committed) return committed.id
    return (await tool.write({ operationId, value })).id
  }
}
`

afterEach(async () => Promise.all(scratch.splice(0).map(path => rm(path, { recursive: true, force: true }))))

sandboxTest('C32 checker accepts idempotent replay and rejects a lookup-only recovery that duplicates replays', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eval-c32-checker-'))
  scratch.push(root)
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'data'), { recursive: true })
  await cp(checkerSource, join(root, '__eval_check__'), { recursive: true })
  await writeFile(join(root, 'data/operation.json'), JSON.stringify({ operationId: 'order-71', value: 'approved' }))

  const check = async (implementation: string) => {
    await writeFile(join(root, 'src/write.ts'), implementation)
    return runIsolatedChecker(['test', './__eval_check__'], root, { readOnlyPaths: ['__eval_check__'] })
  }

  const valid = await check(reference)
  expect(valid.exitCode).toBe(0)
  expect(valid.positiveTestEvidence).toBe(true)

  const duplicateReplay = await check(replayDuplicates)
  expect(duplicateReplay.exitCode).not.toBe(0)
})
