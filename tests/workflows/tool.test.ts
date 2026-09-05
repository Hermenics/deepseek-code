import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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

  test('returns the execution error for a failed workflow', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-tool-'))
    roots.push(root)
    const manager = new WorkflowManager({
      sessionId: 'tool-session', projectRoot: root, baseDirectory: join(root, 'state'), providerConfig: { provider: 'deepseek' },
    })
    const output = JSON.parse(await Workflow.execute({
      script: 'export const meta = {"name":"tool-failure"}; throw new Error("workflow exploded");',
    }, {
      sessionId: 'tool-session', workspacePath: root, projectRoot: root,
      permissionProfile: 'coordinator-integrator', workflowManager: manager, interactionMode: 'build',
    }))

    expect(output).toMatchObject({ status: 'failed' })
    expect(output.error).toContain('workflow exploded')
  })

  test('cancels the workflow when the tool context is aborted', async () => {
    const controller = new AbortController()
    let cancelReason: string | undefined
    let finish: (value: object) => void = () => {}
    const result = new Promise<object>(resolve => { finish = resolve })
    const manager = {
      async resolveScript(source: { script?: string; name?: string }) { return { script: source.script ?? '', name: source.name } },
      async start() {
        return {
          runId: 'cancelled-run', result,
          cancel(reason?: string) {
            cancelReason = reason
            finish({ runId: 'cancelled-run', status: 'cancelled', result: null, usage: {}, failures: [], worktrees: [] })
          },
        }
      },
    } as unknown as WorkflowManager
    const output = Workflow.execute({ script: 'return 1', name: 'cancelled' }, {
      sessionId: 'tool-session', workspacePath: '/', projectRoot: '/', signal: controller.signal,
      permissionProfile: 'coordinator-integrator', workflowManager: manager, interactionMode: 'build',
    })

    controller.abort(new Error('parent stopped'))
    expect(JSON.parse(await output).status).toBe('cancelled')
    expect(cancelReason).toBe('parent stopped')
  })
})

describe('Workflow tool — script sources', () => {
  test('runs a saved workflow by name and returns the persisted script and journal paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-tool-'))
    roots.push(root)
    await mkdir(join(root, '.deepseek', 'workflows'), { recursive: true })
    await writeFile(join(root, '.deepseek', 'workflows', 'greet.js'), 'export const meta = {"name":"greet"}; return agent("hi " + args.who);')
    const manager = new WorkflowManager({
      sessionId: 'tool-session', projectRoot: root, baseDirectory: join(root, 'state'),
      providerConfig: { provider: 'deepseek' }, agentRunner: async request => ({ value: request.prompt, usage: { tokens: 1 } }),
    })
    const context = { sessionId: 'tool-session', workspacePath: root, projectRoot: root, permissionProfile: 'coordinator-integrator' as const, workflowManager: manager, interactionMode: 'build' as const }
    const output = JSON.parse(await Workflow.execute({ name: 'greet', args: { who: 'marcelo' } }, context))
    expect(output).toMatchObject({ status: 'completed', result: 'hi marcelo' })
    expect(output.scriptPath).toEndWith('workflow.js')
    expect(output.journalPath).toEndWith('journal.json')

    const resumed = JSON.parse(await Workflow.execute({ scriptPath: output.scriptPath, resumeFromRunId: output.runId, args: { who: 'marcelo' } }, context))
    expect(resumed).toMatchObject({ status: 'completed', result: 'hi marcelo', usage: { agents: 1, tokens: 1 } })
    expect(resumed.runId).not.toBe(output.runId)
    await expect(Workflow.execute({ name: 'missing' }, context)).rejects.toThrow('not found')
  })
})
