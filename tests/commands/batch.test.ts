import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WorkflowManager } from '../../src/workflows/manager.js'
import { executeBatchCommand, parseBatchCommand } from '../../src/commands/batch/index.js'

setDefaultTimeout(15_000)

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

describe('/batch', () => {
  test('parses prompts separated by -- and rejects empty input', () => {
    expect(parseBatchCommand(['inspect', 'auth', '--', 'run', 'tests'])).toEqual({
      type: 'batch', prompts: ['inspect auth', 'run tests'],
    })
    expect(parseBatchCommand([])).toMatchObject({ type: 'unknown' })
    expect(parseBatchCommand(['inspect', '--'])).toMatchObject({ type: 'unknown' })
    const tooMany = Array.from({ length: 17 }, (_, index) => [`prompt-${index}`, '--']).flat().concat('prompt-17')
    expect(parseBatchCommand(tooMany)).toMatchObject({ type: 'unknown' })
  })

  test('executes all prompts through WorkflowManager', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-batch-'))
    roots.push(root)
    const calls: string[] = []
    const manager = new WorkflowManager({
      sessionId: 'batch-test', projectRoot: join(root, 'project'), baseDirectory: join(root, 'state'),
      providerConfig: { provider: 'deepseek' },
      agentRunner: async request => {
        calls.push(request.prompt)
        return { value: `done:${request.prompt}` }
      },
    })

    const parsed = parseBatchCommand(['first', '--', 'second'])
    if (parsed.type !== 'batch') throw new Error('expected a valid batch command')
    const result = await executeBatchCommand(parsed, { workflowManager: manager })

    expect(result.status).toBe('completed')
    expect(result.result).toEqual(['done:first', 'done:second'])
    expect(calls.sort()).toEqual(['first', 'second'])
  })

  test('validates manually constructed commands at the execution boundary', async () => {
    const workflowManager = {
      start: async () => ({ result: Promise.resolve({} as never), runId: 'batch', cancel: () => {} }),
    } as Parameters<typeof executeBatchCommand>[1]['workflowManager']

    await expect(executeBatchCommand({ type: 'batch', prompts: [' '] }, { workflowManager })).rejects.toThrow('non-empty')
  })
})
