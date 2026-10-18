import { expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent, parseToolCallBatchArguments, type AgentCallbacks } from '../src/agent/agent.js'
import type { Tool } from '../src/tools/types.js'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

function makeCallbacks() {
  const state = { done: 0, toolResults: [] as Array<{ name: string; result: string }> }
  const callbacks: AgentCallbacks = {
    onToken() {},
    onToolCall() {},
    onToolResult(name, result) { state.toolResults.push({ name, result }) },
    onDone() { state.done++ },
  }
  return { callbacks, state }
}

function stream(chunks: object[]): AsyncIterable<object> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

async function withAgent(run: (agent: Agent, root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-objective-revision-'))
  const agent = new Agent({ provider: 'local', localModel: 'fixture' }, {
    projectRoot: root,
    logFile: null,
    snapshotFile: null,
    checkpointHistory: async () => {},
  })
  try {
    await agent.readyPromise
    agent.interactionMode = 'auto'
    await run(agent, root)
  } finally {
    await agent.shutdown()
    await rm(root, { recursive: true, force: true })
  }
}

it('aborts an active model request when the objective is revised', async () => {
  await withAgent(async agent => {
    const internal = agent as any
    const requestStarted = deferred()
    let requestCount = 0
    internal.openStream = async () => {
      requestCount++
      const signal = internal.abortController.signal as AbortSignal
      requestStarted.resolve()
      return {
        [Symbol.asyncIterator]() {
          return {
            next: () => new Promise<IteratorResult<object>>((_, reject) => {
              if (signal.aborted) reject(signal.reason ?? new Error('aborted'))
              else signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), { once: true })
            }),
            return: async () => ({ done: true, value: undefined }),
          }
        },
      }
    }

    const { callbacks, state } = makeCallbacks()
    const running = agent.run('Initial objective', callbacks)
    await requestStarted.promise
    expect(agent.reviseObjective()).toBe(1)
    await running

    expect(requestCount).toBe(1)
    expect(state.done).toBe(1)
  })
})

it('does not start a turn that became stale while Agent initialization was pending', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-objective-revision-init-'))
  const agent = new Agent({ provider: 'local', localModel: 'fixture' }, { projectRoot: root, logFile: null, snapshotFile: null })
  const internal = agent as any
  const initialization = internal.readyPromise as Promise<void>
  const releaseReady = deferred<void>()
  internal.readyPromise = releaseReady.promise
  let requestCount = 0
  internal.openStream = async () => {
    requestCount++
    return stream([])
  }
  const { callbacks, state } = makeCallbacks()

  try {
    const running = agent.run('Initial objective', callbacks)
    expect(agent.reviseObjective()).toBe(1)
    releaseReady.resolve()
    await running

    expect(requestCount).toBe(0)
    expect(state.done).toBe(1)
  } finally {
    await initialization.catch(() => {})
    await agent.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})

it('rejects a prompt whose accepted objective epoch changed before Agent.run was invoked', async () => {
  await withAgent(async agent => {
    const internal = agent as any
    const acceptedEpoch = agent.getObjectiveEpoch()
    let requestCount = 0
    internal.openStream = async () => {
      requestCount++
      return stream([])
    }
    const { callbacks, state } = makeCallbacks()

    agent.reviseObjective()
    await agent.run('Prompt accepted under the prior objective', callbacks, acceptedEpoch)

    expect(requestCount).toBe(0)
    expect(state.done).toBe(1)
  })
})

it('discards a deferred prompt refinement after the objective is revised', async () => {
  await withAgent(async agent => {
    const internal = agent as any
    const refinementStarted = deferred<void>()
    const finishRefinement = deferred<any>()
    let requestCount = 0
    internal.settings.promptRefiner = { enabled: true, minimumLength: 30 }
    internal.client = {
      chat: { completions: { create: async () => {
        refinementStarted.resolve()
        return finishRefinement.promise
      } } },
    }
    internal.openStream = async () => {
      requestCount++
      return stream([])
    }
    const { callbacks, state } = makeCallbacks()

    const running = agent.run('Please implement the requested feature carefully.', callbacks)
    await refinementStarted.promise
    agent.reviseObjective()
    finishRefinement.resolve({ choices: [{ message: { content: 'Stale optional clarification.' } }] })
    await running

    expect(requestCount).toBe(0)
    expect(agent.getLastUserMessage()).toBeNull()
    expect(agent.getLastUserPrompt()).toBeNull()
    expect(JSON.stringify(agent.getMessages())).not.toContain('Stale optional clarification.')
    expect(state.done).toBe(1)
  })
})

it('cancels an outstanding permission wait without recording a user denial', async () => {
  await withAgent(async agent => {
    const internal = agent as any
    internal.abortController = new AbortController()
    const promptStarted = deferred()
    agent.setToolPermissionHandler((_request, signal) => new Promise(resolve => {
      promptStarted.resolve()
      signal?.addEventListener('abort', () => resolve('reject'), { once: true })
    }))

    const pending = internal.requestToolPermission({ toolName: 'shell', args: { command: 'true' }, reason: 'permission' })
    await promptStarted.promise
    agent.reviseObjective()

    await expect(pending).rejects.toBeDefined()
    const evidence = JSON.parse(internal.sessionEvidence.snapshot().content as string) as Array<{ kind: string; text: string }>
    expect(evidence.some(event => event.kind === 'authorization' || event.kind === 'denial')).toBe(false)
  })
})

it('finishes the started batch action and skips the stale following action', async () => {
  await withAgent(async agent => {
    const internal = agent as any
    const firstStarted = deferred()
    const finishFirst = deferred()
    const executeCalls: string[] = []
    let requestCount = 0
    const shell = internal.toolMap.get('shell') as Tool
    internal.toolMap.set('shell', {
      ...shell,
      execute: async (args: Record<string, unknown>) => {
        executeCalls.push(String(args.command))
        if (executeCalls.length === 1) {
          firstStarted.resolve()
          await finishFirst.promise
          return 'The started command finished atomically.'
        }
        return 'The second command must never start.'
      },
    })
    internal.runPostToolBatchHooks = async () => {}
    internal.openStream = async () => {
      requestCount++
      return stream([{
        choices: [{
          delta: { tool_calls: [
            { index: 0, id: 'started-shell-call', function: { name: 'shell', arguments: '{"command":"printf first"}' } },
            { index: 1, id: 'stale-shell-call', function: { name: 'shell', arguments: '{"command":"printf second"}' } },
          ] },
          finish_reason: 'tool_calls',
        }],
      }])
    }

    const { callbacks, state } = makeCallbacks()
    const running = agent.run('Initial objective', callbacks)
    await firstStarted.promise
    agent.reviseObjective()
    finishFirst.resolve()
    await running

    expect(executeCalls).toEqual(['printf first'])
    expect(state.toolResults.find(result => result.result.includes('Objective revision changed'))).toMatchObject({ name: 'shell' })
    expect(requestCount).toBe(1)
    expect(state.done).toBe(1)
  })
})

it('returns typed envelopes for rejected, cancelled, and invalid tool calls', async () => {
  await withAgent(async agent => {
    const internal = agent as any
    const call = { id: 'typed-boundary-call', type: 'function' as const, function: { name: 'shell', arguments: '{}' } }

    internal.turnObjectiveRevision = 0
    internal.objectiveRevision = 1
    const stale = await internal.checkAndExecuteTool(call, {}, makeCallbacks().callbacks)
    expect(JSON.parse(stale.result)).toMatchObject({
      schemaVersion: 1,
      status: 'error',
      error: { kind: 'conflict', code: 'OBJECTIVE_SUPERSEDED', retryable: false },
    })

    internal.turnObjectiveRevision = 1
    internal.abortController = new AbortController()
    internal.abortController.abort()
    const cancelled = await internal.checkAndExecuteTool(call, {}, makeCallbacks().callbacks)
    expect(JSON.parse(cancelled.result)).toMatchObject({
      schemaVersion: 1,
      status: 'error',
      error: { kind: 'tool', code: 'CANCELLED', retryable: false },
    })

    internal.abortController = new AbortController()
    agent.interactionMode = 'plan'
    internal.planFilePath = '/expected/PLAN.md'
    const invalidPlan = await internal.checkAndExecuteTool({
      id: 'typed-plan-call', type: 'function', function: { name: 'submit_plan', arguments: '{}' },
    }, { path: '/wrong/PLAN.md' }, makeCallbacks().callbacks)
    expect(JSON.parse(invalidPlan.result)).toMatchObject({
      schemaVersion: 1,
      status: 'error',
      error: { kind: 'validation', code: 'INVALID_ARGUMENTS', retryable: false },
    })

    const parsed = parseToolCallBatchArguments([{
      id: 'typed-parse-call', type: 'function', function: { name: 'read_file', arguments: '{' },
    }], 'tool_calls')[0]!
    const parseResult = await internal.executeParsedCall(parsed, makeCallbacks().callbacks)
    expect(JSON.parse(parseResult.result)).toMatchObject({
      schemaVersion: 1,
      status: 'error',
      error: { kind: 'validation', code: 'INVALID_ARGUMENTS', retryable: false },
    })
  })
})
