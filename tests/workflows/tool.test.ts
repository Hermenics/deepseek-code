import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Workflow } from '../../src/tools/Workflow/Workflow.js'
import { WorkflowManager } from '../../src/workflows/manager.js'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

describe('Workflow tool', () => {
  test('returns the public result envelope', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-tool-'))
    roots.push(root)
    const manager = new WorkflowManager({
      sessionId: 'tool-session', projectRoot: root, baseDirectory: join(root, 'state'),
      providerConfig: { provider: 'deepseek' }, agentRunner: async request => ({ value: request.prompt, usage: { tokens: 4 } }),
    })
    const output = JSON.parse(await Workflow.execute({
      script: 'export const meta = {"name":"tool-test"}; return agent("hello");',
    }, {
      sessionId: 'tool-session', workspacePath: root, projectRoot: root,
      permissionProfile: 'coordinator-integrator', workflowManager: manager, interactionMode: 'build',
    }))

    expect(output.status).toBe('completed')
    expect(output.result).toBe('hello')
    expect(output.usage).toEqual({ agents: 1, tokens: 4, costUsd: 0 })
  })
})
