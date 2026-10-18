import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
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

  it('counts repeated failures when JSON object keys are reordered', async () => {
    const agent = new Agent()
    await agent.readyPromise.catch(() => {})
    const note = (args: Record<string, unknown>) => (agent as unknown as {
      noteRepeatedFailure(tool: string, args: Record<string, unknown>, result: string): string
    }).noteRepeatedFailure('shell', args, 'Command exited with code 1.\n1 fail')

    expect(note({ command: 'bun test', cwd: '/repo' })).not.toContain('[Repeated failure]')
    expect(note({ cwd: '/repo', command: 'bun test' })).not.toContain('[Repeated failure]')
    expect(note({ command: 'bun test', cwd: '/repo' })).toContain('[Repeated failure] This exact call has failed 3 times')
    await agent.shutdown()
  })

  it('blocks an unchanged fourth tool call after three identical failures', async () => {
    let id = 0
    const readMissing = () => (async function* () {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: `missing-${++id}`, type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: `__missing_retry_${process.pid}.txt` }) } }] }, finish_reason: 'tool_calls' }] }
    })()
    const { agent, requests } = await scriptedAgent([readMissing, readMissing, readMissing, readMissing, () => textResponse('Stopped repeating the failed read.')])
    const toolMap = (agent as unknown as { toolMap: Map<string, { execute: (...args: any[]) => Promise<string> }> }).toolMap
    const readTool = toolMap.get('read_file')!
    const execute = readTool.execute.bind(readTool)
    let executions = 0
    readTool.execute = async (...args) => { executions++; return execute(...args) }

    await agent.run('read the same missing file', trackedCallbacks())

    expect(executions).toBe(3)
    expect(JSON.stringify(requests[4])).toContain('REPEATED_FAILURE_BLOCKED')
    expect(JSON.stringify(requests[4])).toContain('not executed')
  })
})

describe('plan tools outside /plan', () => {
  it('assigns a plan file on the first write_plan and does not pause for review in Auto mode', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsk-plan-tools-'))
    const agent = new Agent(undefined, { projectRoot: dir, logFile: null, snapshotFile: null })
    try {
      await agent.readyPromise.catch(() => {})
      const internals = agent as unknown as {
        lastUserMessage: string
        executeToolWithChecks(tc: object, args: Record<string, unknown>, cb: AgentCallbacks, lifecycle: object): Promise<{ result: string }>
      }
      /** Fake tool execution that records the call. */
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
        executeTool(tool: string, args: Record<string, unknown>): Promise<string>
      }
      await writeFile(join(dir, 'a.ts'), 'one\n')

      expect(JSON.parse((await internals.readBeforeEditError('patch_file', { path: 'a.ts' }))!)).toMatchObject({
        schemaVersion: 1,
        status: 'error',
        error: { kind: 'validation', code: 'READ_BEFORE_EDIT_REQUIRED', retryable: false },
      })
      expect(await internals.readBeforeEditError('write_file', { path: 'new.ts' })).toBeNull()
      expect(await internals.readBeforeEditError('read_file', { path: 'a.ts' })).toBeNull()

      await internals.executeTool('read_file', { path: 'a.ts' })
      expect(await internals.readBeforeEditError('edit_file', { path: './a.ts' })).toBeNull()

      await writeFile(join(dir, 'a.ts'), 'one\n// independent human change\n')
      const result = await internals.executeTool('patch_file', { path: 'a.ts', old_content: 'one', new_content: 'two' })
      expect(result).toContain('changed')
      expect(await readFile(join(dir, 'a.ts'), 'utf8')).toBe('one\n// independent human change\n')
      await internals.executeTool('read_file', { path: 'a.ts' })
      expect(await internals.executeTool('patch_file', { path: 'a.ts', old_content: 'one', new_content: 'two' })).not.toContain('Error:')
    } finally {
      await agent.shutdown()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('preserves an independent edit across the core file tools', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsk-cross-tool-file-edit-'))
    const agent = new Agent(undefined, { projectRoot: dir })
    try {
      await agent.readyPromise.catch(() => {})
      const internals = agent as unknown as { executeTool(tool: string, args: Record<string, unknown>): Promise<string> }
      const original = '// preserve this comment\nexport const value = "before"\n'
      const humanEdit = `${original}// independent human change\n`
      const cases = [
        { name: 'write', tool: 'write_file', args: (path: string) => ({ path, content: '// rewritten\nexport const value = "after"\n' }) },
        { name: 'edit', tool: 'edit_file', args: (path: string) => ({ path, edits: [{ line: 2, old: ['before'], new: ['after'] }] }) },
        { name: 'patch', tool: 'patch_file', args: (path: string) => ({ path, old_content: 'value = "before"', new_content: 'value = "after"' }) },
      ]

      for (const entry of cases) {
        const relativePath = `${entry.name}.ts`
        const filePath = join(dir, relativePath)
        await writeFile(filePath, original)
        await internals.executeTool('read_file', { path: relativePath })
        await writeFile(filePath, humanEdit)

        const result = await internals.executeTool(entry.tool, entry.args(relativePath))
        expect(result).toContain('changed')
        expect(await readFile(filePath, 'utf8')).toBe(humanEdit)
      }
    } finally {
      await agent.shutdown()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('outside-workspace refusal (A5)', () => {
  // /mnt is now the shell workspace alias; use a genuinely external host path.
  const outsidePath = join(process.cwd(), '..', 'outside-workspace-gates', 'src', 'a.ts')
  /** Model response that makes one tool call. */
  const toolCallResponse = (name: string, args: object) => () => (async function* () {
    yield { choices: [{ delta: { tool_calls: [{ index: 0, id: `call-${name}`, function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] }
  })()
  /** Callbacks that count finished turns and deny aborts and record tool calls. */
  const denyTracking = () => {
    const cb = {
      done: 0, denyAborted: 0, calls: [] as string[],
      onToken() {}, onToolResult() {}, onDone() { cb.done++ }, onDenyAbort() { cb.denyAborted++ },
      onToolCall(name: string) { cb.calls.push(name) },
    }
    return cb
  }

  it("'deny' still ends the turn silently, but the denied call is now reported", async () => {
    const { agent, requests } = await scriptedAgent([toolCallResponse('read_file', { path: outsidePath })])
    agent.setToolPermissionHandler(async () => 'deny')
    const cb = denyTracking()

    await agent.run('read the file', cb)

    expect(requests).toHaveLength(1)
    expect(cb.denyAborted).toBe(1)
    expect(cb.calls).toEqual(['read_file'])
  })

  it("'reject' skips an outside-workspace action with a typed result and continues the turn", async () => {
    const { agent, requests } = await scriptedAgent([
      toolCallResponse('read_file', { path: outsidePath }),
      () => textResponse('Used the workspace path instead.'),
    ])
    agent.setToolPermissionHandler(async (request) => (request.reason === 'outside_workspace' ? 'reject' : 'session'))
    const cb = denyTracking()

    await agent.run('read the file', cb)

    expect(requests).toHaveLength(2)
    expect(lastMessage(requests[1])).toContain('USER_DENIED')
    expect(lastMessage(requests[1])).toContain('Do not retry it')
    expect(cb.denyAborted).toBe(0)
    expect(cb.done).toBe(1)
  })

  it("'reject' skips permission, risk, and agent-config actions while workflow refusal stays closed", async () => {
    const reasons: string[] = []
    /** Permission handler that records the reason and answers 'reject'. */
    const rejectAll = async (request: { reason: string }) => { reasons.push(request.reason); return 'reject' as const }

    for (const [name, args, setup] of [
      ['read_file', { path: 'package.json' }, (i: Record<string, unknown>) => { (i.settings as Record<string, unknown>).permissions = { allow: ['grep'] } }],
      ['shell', { command: 'rm -rf ./__never_exists__' }, () => {}],
      ['read_file', { path: 'package.json' }, (i: Record<string, unknown>) => { i.allowedTools = '*' }],
    ] as const) {
      const { agent, requests } = await scriptedAgent([toolCallResponse(name, args), () => textResponse('Skipped the denied action.')])
      setup(agent as unknown as Record<string, unknown>)
      agent.setToolPermissionHandler(rejectAll)
      const cb = denyTracking()
      await agent.run('go', cb)
      expect(requests).toHaveLength(2)
      expect(lastMessage(requests[1])).toContain('USER_DENIED')
      expect(cb.denyAborted).toBe(0)
      expect(cb.done).toBe(1)
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

describe('stream idle timeout', () => {
  const ORIGINAL_IDLE = process.env.DEEPSEEK_STREAM_IDLE_TIMEOUT_MS
  beforeEach(() => { process.env.DEEPSEEK_STREAM_IDLE_TIMEOUT_MS = '50' })
  afterEach(() => {
    if (ORIGINAL_IDLE === undefined) delete process.env.DEEPSEEK_STREAM_IDLE_TIMEOUT_MS
    else process.env.DEEPSEEK_STREAM_IDLE_TIMEOUT_MS = ORIGINAL_IDLE
  })

  /** A request the upstream accepts and then never answers, until the request is aborted. */
  const silentResponse = () => (internals: Record<string, unknown>) => {
    const signal = (internals.lastRequestSignal as AbortSignal | undefined)
    return (async function* () {
      await new Promise((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }))
      yield { choices: [{ delta: { content: 'never' }, finish_reason: 'stop' }] }
    })()
  }

  /** The upstream sends headers and then nothing, and its body ignores the abort signal. */
  const deafResponse = () => (): AsyncIterable<object> => ({
    [Symbol.asyncIterator]: () => ({
      next: () => new Promise<IteratorResult<object>>(() => {}),
      return: async () => ({ done: true as const, value: undefined }),
    }),
  })

  it('retries a stream whose body never delivers a chunk, even when it ignores abort', async () => {
    const { agent, requests } = await scriptedAgent([deafResponse(), () => textResponse('Recovered.')])
    const cb = trackedCallbacks()
    const tokens: string[] = []
    cb.onToken = (t: string) => { tokens.push(t) }

    await agent.run('go', cb)

    expect(requests).toHaveLength(2)
    expect(tokens.join('')).toContain('Recovered.')
  }, 5_000)

  it('ends the turn promptly on abort while a deaf stream is open', async () => {
    process.env.DEEPSEEK_STREAM_IDLE_TIMEOUT_MS = '100000'
    const { agent } = await scriptedAgent([deafResponse()])
    const cb = trackedCallbacks()
    setTimeout(() => agent.abort(), 100)

    await agent.run('go', cb)

    expect(cb.done).toBe(1)
  }, 5_000)

  it('retries a request that never sends a chunk instead of hanging the turn', async () => {
    const { agent, requests } = await scriptedAgent([silentResponse(), () => textResponse('Recovered.')])
    const internals = agent as unknown as Record<string, unknown>
    /** Captures the request signal before delegating to the scripted client. */
    const create = (internals.client as { chat: { completions: { create: (body: object, options?: { signal?: AbortSignal }) => unknown } } }).chat.completions
    const scripted = create.create
    create.create = (body: object, options?: { signal?: AbortSignal }) => { internals.lastRequestSignal = options?.signal; return scripted(body, options) }
    const cb = trackedCallbacks()
    const tokens: string[] = []
    cb.onToken = (t: string) => { tokens.push(t) }

    await agent.run('go', cb)

    expect(requests).toHaveLength(2)
    expect(tokens.join('')).toContain('Recovered.')
    expect(cb.done).toBe(1)
  }, 5_000)
})
