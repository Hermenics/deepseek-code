import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent, type AgentCallbacks } from '../src/agent/agent.js'
import { addTodo, clearTodos } from '../src/agent/todoStore.js'
import type { VerificationResult } from '../src/agent/verify.js'

const HISTORY_PATH = join(tmpdir(), `deepseek-code-gates-history-${process.pid}.json`)
const ORIGINAL_HISTORY_PATH = process.env.DEEPSEEK_HISTORY_PATH

beforeAll(() => {
  process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-key-for-unit-tests'
  process.env.DEEPSEEK_HISTORY_PATH = HISTORY_PATH
})

afterAll(async () => {
  if (ORIGINAL_HISTORY_PATH === undefined) delete process.env.DEEPSEEK_HISTORY_PATH
  else process.env.DEEPSEEK_HISTORY_PATH = ORIGINAL_HISTORY_PATH
  await rm(HISTORY_PATH, { force: true })
})

// The todo store is module state shared with other test files running in the same process.
beforeEach(() => clearTodos())
afterEach(() => clearTodos())

type ApiMessage = { role: string; content: unknown }

async function* textResponse(content: string) {
  yield { choices: [{ delta: { content }, finish_reason: 'stop' }] }
}

function trackedCallbacks(): AgentCallbacks & { done: number } {
  const cb = { done: 0, onToken() {}, onToolCall() {}, onToolResult() {}, onDone() { cb.done++ } }
  return cb
}

/** Agent whose model answers each request with the next scripted response. */
async function scriptedAgent(responses: Array<(internals: Record<string, unknown>) => AsyncIterable<object>>) {
  const agent = new Agent()
  await agent.readyPromise.catch(() => {})
  const internals = agent as unknown as Record<string, unknown>
  const requests: ApiMessage[][] = []
  internals.client = {
    chat: {
      completions: {
        create: mock((body: { messages: ApiMessage[]; stream?: boolean }) => {
          // Non-streaming calls are the background auto-memory extraction, not the agent loop.
          if (!body.stream) return Promise.resolve({ choices: [{ message: { content: '{"kind":"none","fact":""}' } }] })
          requests.push(body.messages)
          const next = responses[requests.length - 1]
          if (!next) throw new Error(`unexpected model request #${requests.length}`)
          return next(internals)
        }),
      },
    },
  }
  agent.interactionMode = 'build'
  return { agent, requests }
}

const editedTurn = (content: string) => (internals: Record<string, unknown>) => {
  ;(internals.turnModifiedFiles as Set<string>).add('src/feature.ts')
  return textResponse(content)
}
const lastMessage = (messages: ApiMessage[] | undefined) => JSON.stringify(messages?.at(-1)?.content ?? '')
const failure = (output: string): VerificationResult => ({ ok: false, output, command: { command: 'bun', args: ['test'], display: 'bun test' } })
const success: VerificationResult = { ok: true, output: '3 pass', command: { command: 'bun', args: ['test'], display: 'bun test' } }

describe('completion gates', () => {
  it('feeds a failed verification back to the model and finishes once it passes', async () => {
    const { agent, requests } = await scriptedAgent([editedTurn('Implemented.'), () => textResponse('Fixed the failing assertion.')])
    const results = [failure('1 fail: expected 2, received 3'), success]
    const verify = mock(async () => results.shift())
    agent.setVerificationHandler(verify)
    const cb = trackedCallbacks()

    await agent.run('implement the feature', cb)

    expect(requests).toHaveLength(2)
    expect(lastMessage(requests[1])).toContain('[Verification failed — attempt 1 of 2]')
    expect(lastMessage(requests[1])).toContain('expected 2, received 3')
    expect(verify).toHaveBeenCalledTimes(2)
    expect(cb.done).toBe(1)
  })

  it('stops feeding back a failing verification after two retries', async () => {
    const { agent, requests } = await scriptedAgent([editedTurn('One.'), () => textResponse('Two.'), () => textResponse('Three.')])
    agent.setVerificationHandler(async () => failure('still failing'))
    const cb = trackedCallbacks()

    await agent.run('implement the feature', cb)

    expect(requests).toHaveLength(3)
    expect(lastMessage(requests[2])).toContain('attempt 2 of 2')
    expect(cb.done).toBe(1)
  })

  it('reminds the model once about todo items it opened or updated this turn', async () => {
    const { agent, requests } = await scriptedAgent([
      () => {
        addTodo('write the regression test')
        return textResponse('Done.')
      },
      () => textResponse('Done, really.'),
    ])
    const cb = trackedCallbacks()

    await agent.run('fix the bug', cb)

    expect(requests).toHaveLength(2)
    expect(lastMessage(requests[1])).toContain('[Completion check]')
    expect(lastMessage(requests[1])).toContain('write the regression test')
    expect(cb.done).toBe(1)
  })

  it('asks the model to continue after a response with no text and no tool calls', async () => {
    async function* emptyResponse() {
      yield { choices: [{ delta: {}, finish_reason: 'stop' }] }
    }
    const { agent, requests } = await scriptedAgent([() => emptyResponse(), () => emptyResponse(), () => emptyResponse()])
    const cb = trackedCallbacks()

    await agent.run('create the parser', cb)

    expect(requests).toHaveLength(3)
    expect(lastMessage(requests[1])).toContain('[Empty response]')
    expect(lastMessage(requests[2])).toContain('[Empty response]')
    expect(cb.done).toBe(1)
  })

  it('does not nudge about todos in read-only modes', async () => {
    const { agent, requests } = await scriptedAgent([() => {
      addTodo('step from a plan')
      return textResponse('Plan written.')
    }])
    agent.interactionMode = 'plan'

    await agent.run('plan the change', trackedCallbacks())

    expect(requests).toHaveLength(1)
  })

  it('lists only the todo items added or updated this turn', async () => {
    addTodo('abandoned step')
    const { agent, requests } = await scriptedAgent([
      () => {
        addTodo('new step')
        return textResponse('Done.')
      },
      () => textResponse('Done, really.'),
    ])

    await agent.run('fix the bug', trackedCallbacks())

    expect(requests).toHaveLength(2)
    expect(lastMessage(requests[1])).toContain('new step')
    expect(lastMessage(requests[1])).not.toContain('abandoned step')
  })

  it('does not nudge about todos left open by an earlier turn', async () => {
    addTodo('abandoned step')
    const { agent, requests } = await scriptedAgent([() => textResponse('It parses the config file.')])

    await agent.run('what does this function do?', trackedCallbacks())

    expect(requests).toHaveLength(1)
  })
})

describe('output limit and repeated failures', () => {
  it('asks the model to continue a response cut off at the output-token limit', async () => {
    async function* cutOff() {
      yield { choices: [{ delta: { content: 'First half of the answer' }, finish_reason: 'length' }] }
    }
    const { agent, requests } = await scriptedAgent([() => cutOff(), () => textResponse(' and the second half.')])
    const cb = trackedCallbacks()

    await agent.run('explain everything', cb)

    expect(requests).toHaveLength(2)
    expect(lastMessage(requests[1])).toContain('[Output limit]')
    expect(JSON.stringify(requests[1]!.at(-2)?.content)).toContain('First half of the answer')
    expect(cb.done).toBe(1)
  })

  it('flags the third identical failing call and resets after a success', async () => {
    const agent = new Agent()
    await agent.readyPromise.catch(() => {})
    const note = (result: string) => (agent as unknown as {
      noteRepeatedFailure(tool: string, args: Record<string, unknown>, result: string): string
    }).noteRepeatedFailure('shell', { command: 'bun test' }, result)
    const failing = 'Command exited with code 1.\n1 fail'

    expect(note(failing)).toBe(failing)
    expect(note(failing)).toBe(failing)
    expect(note(failing)).toContain('[Repeated failure] This exact call has failed 3 times')
    expect(note('3 pass')).toBe('3 pass')
    expect(note(failing)).toBe(failing)
  })
})

describe('plan tools outside /plan', () => {
  it('assigns a plan file on the first write_plan and does not pause for review in Auto mode', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsk-plan-tools-'))
    const agent = new Agent(undefined, { projectRoot: dir })
    try {
      await agent.readyPromise.catch(() => {})
      const internals = agent as unknown as {
        lastUserMessage: string
        executeToolWithChecks(tc: object, args: Record<string, unknown>, cb: AgentCallbacks, lifecycle: object): Promise<{ result: string }>
      }
      const exec = (name: string, args: Record<string, unknown>) => internals.executeToolWithChecks(
        { id: `call-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }, args, trackedCallbacks(), {},
      )
      internals.lastUserMessage = 'Add response caching'
      agent.interactionMode = 'plan'

      const written = await exec('write_plan', { content: '# Plan\n' })

      expect(agent.planFilePath).toContain(join(dir, '.plans', 'add-response-caching-'))
      expect(written.result).toBe(`Plan written to ${agent.planFilePath}`)

      agent.interactionMode = 'auto'
      const submitted = await exec('submit_plan', { path: agent.planFilePath })
      expect(JSON.parse(submitted.result)).toMatchObject({ approved: true })
    } finally {
      await agent.shutdown()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('plan approval abort', () => {
  it('stops the turn instead of returning an error the model would work around', async () => {
    const agent = new Agent()
    await agent.readyPromise.catch(() => {})
    agent.interactionMode = 'plan'
    agent.planFilePath = join(tmpdir(), 'plan.md')
    agent.setPlanSubmitHandler(() => Promise.reject('aborted'))
    const internals = agent as unknown as {
      executeToolWithChecks(tc: object, args: Record<string, unknown>, cb: AgentCallbacks, lifecycle: object): Promise<{ result: string }>
    }
    const args = { path: agent.planFilePath }

    const submission = internals.executeToolWithChecks(
      { id: 'call-submit', type: 'function', function: { name: 'submit_plan', arguments: JSON.stringify(args) } }, args, trackedCallbacks(), {},
    )

    await expect(submission).rejects.toThrow('deny-abort')
  })
})

describe('read before edit', () => {
  it('requires a read before editing an existing file and a re-read after it changes on disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsk-read-before-edit-'))
    const agent = new Agent(undefined, { projectRoot: dir })
    try {
      await agent.readyPromise.catch(() => {})
      const internals = agent as unknown as {
        readBeforeEditError(tool: string, args: Record<string, unknown>): Promise<string | null>
        recordFileSeen(tool: string, args: Record<string, unknown>, result: string): Promise<void>
      }
      await writeFile(join(dir, 'a.ts'), 'one\n')

      expect(await internals.readBeforeEditError('patch_file', { path: 'a.ts' })).toContain('read a.ts with read_file before editing it')
      expect(await internals.readBeforeEditError('write_file', { path: 'new.ts' })).toBeNull()
      expect(await internals.readBeforeEditError('read_file', { path: 'a.ts' })).toBeNull()

      await internals.recordFileSeen('read_file', { path: 'a.ts' }, '[a.ts  2 lines total  showing 1–2]')
      expect(await internals.readBeforeEditError('edit_file', { path: './a.ts' })).toBeNull()

      const later = new Date(Date.now() + 5_000)
      await utimes(join(dir, 'a.ts'), later, later)
      expect(await internals.readBeforeEditError('edit_file', { path: 'a.ts' })).toContain('changed on disk since you last read it')

      await internals.recordFileSeen('read_file', { path: 'a.ts' }, 'Error: permission denied')
      expect(await internals.readBeforeEditError('edit_file', { path: 'a.ts' })).toContain('changed on disk')
    } finally {
      await agent.shutdown()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('outside-workspace refusal (A5)', () => {
  const toolCallResponse = (name: string, args: object) => () => (async function* () {
    yield { choices: [{ delta: { tool_calls: [{ index: 0, id: `call-${name}`, function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] }
  })()
  const denyTracking = () => {
    const cb = {
      done: 0, denyAborted: 0, calls: [] as string[],
      onToken() {}, onToolResult() {}, onDone() { cb.done++ }, onDenyAbort() { cb.denyAborted++ },
      onToolCall(name: string) { cb.calls.push(name) },
    }
    return cb
  }

  it("'deny' still ends the turn silently, but the denied call is now reported", async () => {
    const { agent, requests } = await scriptedAgent([toolCallResponse('read_file', { path: '/mnt/x/src/a.ts' })])
    agent.setToolPermissionHandler(async () => 'deny')
    const cb = denyTracking()

    await agent.run('read the file', cb)

    expect(requests).toHaveLength(1)
    expect(cb.denyAborted).toBe(1)
    expect(cb.calls).toEqual(['read_file'])
  })

  it("'reject' hands the model a path error and the turn continues to a final answer", async () => {
    const { agent, requests } = await scriptedAgent([
      toolCallResponse('read_file', { path: '/mnt/x/src/a.ts' }),
      () => textResponse('Used the workspace path instead.'),
    ])
    agent.setToolPermissionHandler(async (request) => (request.reason === 'outside_workspace' ? 'reject' : 'session'))
    const cb = denyTracking()

    await agent.run('read the file', cb)

    expect(requests).toHaveLength(2)
    expect(lastMessage(requests[1])).toContain('outside the workspace')
    expect(cb.denyAborted).toBe(0)
    expect(cb.done).toBe(1)
  })

  it("'reject' for any other reason fails closed like 'deny'", async () => {
    const reasons: string[] = []
    const rejectAll = async (request: { reason: string }) => { reasons.push(request.reason); return 'reject' as const }

    for (const [name, args, setup] of [
      ['read_file', { path: 'package.json' }, (i: Record<string, unknown>) => { (i.settings as Record<string, unknown>).permissions = { allow: ['grep'] } }],
      ['shell', { command: 'rm -rf ./__never_exists__' }, () => {}],
      ['read_file', { path: 'package.json' }, (i: Record<string, unknown>) => { i.allowedTools = '*' }],
    ] as const) {
      const { agent, requests } = await scriptedAgent([toolCallResponse(name, args)])
      setup(agent as unknown as Record<string, unknown>)
      agent.setToolPermissionHandler(rejectAll)
      const cb = denyTracking()
      await agent.run('go', cb)
      expect(requests).toHaveLength(1)
      expect(cb.denyAborted).toBe(1)
    }
    expect(reasons).toEqual(['permission', 'risk', 'agent_config'])

    const agent = new Agent()
    await agent.readyPromise.catch(() => {})
    agent.interactionMode = 'build'
    agent.setToolPermissionHandler(rejectAll)
    await expect(agent.startWorkflow({ script: 'return 1' })).rejects.toThrow('Workflow execution denied')
    expect(reasons.at(-1)).toBe('workflow')
    await agent.shutdown()
  })
})
