import { afterEach, expect, it, mock } from 'bun:test'
import { Agent } from '../src/agent/agent.js'
import { assertConversationMessageBudget, assertProviderRequestBudget, CONVERSATION_MESSAGE_BYTES, TOOL_BATCH_BYTES } from '../src/agent/toolOutputBudget.js'
import { estimateCost } from '../src/agent/cost.js'
import { AGGREGATE_TURN_BYTES } from '../src/orchestration/aggregateBudget.js'
import { previewPromptRefinement } from '../src/agent/promptRefiner.js'
import type OpenAI from 'openai'

const agents: Agent[] = []

afterEach(async () => {
  await Promise.all(agents.splice(0).map((agent) => agent.shutdown()))
})

it('measures serialized conversation bytes for compatibility callers', () => {
  const messages = [{ role: 'user', content: '' }]
  const emptyBytes = Buffer.byteLength(JSON.stringify(messages), 'utf8')
  messages[0]!.content = 'x'.repeat(CONVERSATION_MESSAGE_BYTES - emptyBytes)

  expect(assertConversationMessageBudget(messages)).toBe(CONVERSATION_MESSAGE_BYTES)
  expect(() => assertConversationMessageBudget([{ role: 'user', content: `${messages[0]!.content}x` }]))
    .toThrow('serialized conversation messages exceed the 4 MiB UTF-8 limit')
  expect(assertConversationMessageBudget([{ role: 'user', content: 'é😀' }]))
    .toBe(Buffer.byteLength(JSON.stringify([{ role: 'user', content: 'é😀' }]), 'utf8'))
  expect(CONVERSATION_MESSAGE_BYTES).toBeGreaterThan(TOOL_BATCH_BYTES)
})

it('measures the complete serialized provider body, including tool schemas', () => {
  const request = { model: 'test', messages: [{ role: 'user', content: 'short' }], tools: [{ type: 'function', function: { description: 'x'.repeat(CONVERSATION_MESSAGE_BYTES) } }] }
  const smallRequest = { model: 'test', messages: [{ role: 'user', content: 'é😀' }] }
  expect(assertProviderRequestBudget(smallRequest)).toBe(Buffer.byteLength(JSON.stringify(smallRequest), 'utf8'))
  expect(() => assertProviderRequestBudget(request)).toThrow('serialized provider request exceeds the 4 MiB UTF-8 limit')
})

it('rejects an oversized provider request containing a user image before dispatch', async () => {
  const agent = new Agent(
    { provider: 'vertex', gcpProject: 'test', gcpLocation: 'global', gcpCredentials: '/tmp/test-service-account.json' },
    { simulationMode: true, logFile: null, snapshotFile: null },
  )
  agents.push(agent)
  ;(agent as unknown as Record<string, unknown>).readyPromise = Promise.resolve()

  const create = mock(() => { throw new Error('provider must not be called') })
  ;(agent as unknown as Record<string, unknown>).client = { chat: { completions: { create } } }

  await expect(agent.run({ text: 'inspect this image', images: [{ mediaType: 'image/png', data: 'A'.repeat(CONVERSATION_MESSAGE_BYTES) }] }, {
    onToken() {},
    onToolCall() {},
    onToolResult() {},
    onDone() {},
  })).rejects.toThrow('serialized provider request exceeds the 4 MiB UTF-8 limit')

  expect(create).not.toHaveBeenCalled()
})

it('rejects an oversized orchestrator model reference after it is appended to the request', async () => {
  const agent = new Agent(
    { provider: 'vertex', gcpProject: 'test', gcpLocation: 'global', gcpCredentials: '/tmp/test-service-account.json' },
    { simulationMode: true, logFile: null, snapshotFile: null },
  )
  agents.push(agent)
  ;(agent as unknown as Record<string, unknown>).readyPromise = Promise.resolve()
  const orchestrator = (agent as unknown as { orchestrator: { modelReference: () => Promise<string | undefined> } }).orchestrator
  orchestrator.modelReference = async () => `model reference ${'r'.repeat(CONVERSATION_MESSAGE_BYTES)}`

  const create = mock(() => { throw new Error('provider must not be called') })
  ;(agent as unknown as Record<string, unknown>).client = { chat: { completions: { create } } }

  await expect(agent.run('short request', {
    onToken() {},
    onToolCall() {},
    onToolResult() {},
    onDone() {},
  })).rejects.toThrow('serialized provider request exceeds the 4 MiB UTF-8 limit')

  expect(create).not.toHaveBeenCalled()
})

it('rejects an oversized final /btw request before provider dispatch', async () => {
  const agent = new Agent(
    { provider: 'vertex', gcpProject: 'test', gcpLocation: 'global', gcpCredentials: '/tmp/test-service-account.json' },
    { simulationMode: true, logFile: null, snapshotFile: null },
  )
  agents.push(agent)
  ;(agent as unknown as Record<string, unknown>).readyPromise = Promise.resolve()

  const create = mock(() => { throw new Error('provider must not be called') })
  ;(agent as unknown as Record<string, unknown>).client = { chat: { completions: { create } } }

  await expect(agent.askBtw(`question ${'q'.repeat(CONVERSATION_MESSAGE_BYTES)}`))
    .rejects.toThrow('serialized provider request exceeds the 4 MiB UTF-8 limit')

  expect(create).not.toHaveBeenCalled()
})

it('rejects an oversized tool schema in the primary provider request before dispatch', () => {
  const agent = new Agent(
    { provider: 'vertex', gcpProject: 'test', gcpLocation: 'global', gcpCredentials: '/tmp/test-service-account.json' },
    { simulationMode: true, logFile: null, snapshotFile: null },
  )
  agents.push(agent)
  const create = mock(() => { throw new Error('provider must not be called') })
  ;(agent as unknown as Record<string, unknown>).client = { chat: { completions: { create } } }
  const dispatch = (agent as unknown as { createProviderCompletion(body: Record<string, unknown>): unknown }).createProviderCompletion.bind(agent)

  expect(() => dispatch({
    model: 'test', messages: [{ role: 'user', content: 'short' }],
    tools: [{ type: 'function', function: { name: 'large_schema', description: 'x'.repeat(CONVERSATION_MESSAGE_BYTES) } }],
  })).toThrow('serialized provider request exceeds the 4 MiB UTF-8 limit')
  expect(create).not.toHaveBeenCalled()
})

it('sets a finite default output-token limit for providers without a model override', () => {
  const agent = new Agent(
    { provider: 'vertex', gcpProject: 'test', gcpLocation: 'global', gcpCredentials: '/tmp/test-service-account.json' },
    { simulationMode: true, logFile: null, snapshotFile: null },
  )
  agents.push(agent)
  ;(agent as unknown as Record<string, unknown>).settings = { model: 'test-model' }

  expect((agent as unknown as { getSamplingParams(): Record<string, unknown> }).getSamplingParams().max_tokens).toBe(32768)
})

it('caps every primary request by the remaining per-turn aggregate completion allowance', async () => {
  const agent = new Agent(
    { provider: 'local', localModel: 'test-model' },
    { simulationMode: true, logFile: null, snapshotFile: null },
  )
  agents.push(agent)
  const internal = agent as unknown as { orchestrator: { configure(input: { limits: { maxAggregateTokens: number } }): void }; turnBudgetGroupId: string; createProviderCompletion(body: Record<string, unknown>): Promise<any> }
  internal.orchestrator.configure({ limits: { maxAggregateTokens: 5 } })
  internal.turnBudgetGroupId = 'primary-budget-test'
  const create = mock(async (_request: Record<string, unknown>) => ({ choices: [{ message: { content: 'answer' } }], usage: { total_tokens: create.mock.calls.length === 1 ? 4 : 1 } }))
  ;(agent as unknown as Record<string, any>).client = { chat: { completions: { create } } }

  await internal.createProviderCompletion({ model: 'test-model', messages: [], max_tokens: 20, stream: false })
  await internal.createProviderCompletion({ model: 'test-model', messages: [], max_tokens: 20, stream: false })

  expect(create.mock.calls.map(([request]) => request.max_tokens)).toEqual([5, 1])
  await expect(internal.createProviderCompletion({ model: 'test-model', messages: [], max_tokens: 20, stream: false }))
    .rejects.toMatchObject({ code: 'AGGREGATE_BUDGET_EXHAUSTED' })
  expect(create).toHaveBeenCalledTimes(2)
})

it('shares the aggregate UTF-8 byte ceiling across primary provider requests', async () => {
  const agent = new Agent(
    { provider: 'local', localModel: 'test-model' },
    { simulationMode: true, logFile: null, snapshotFile: null },
  )
  agents.push(agent)
  const internal = agent as unknown as { turnBudgetGroupId: string; createProviderCompletion(body: Record<string, unknown>): Promise<any> }
  internal.turnBudgetGroupId = 'primary-byte-budget-test'
  const create = mock(async (_request: Record<string, unknown>) => ({ choices: [{ message: { content: 'answer' } }] }))
  ;(agent as unknown as Record<string, any>).client = { chat: { completions: { create } } }
  const body: Record<string, any> = { model: 'test-model', messages: [{ role: 'user', content: '' }], max_tokens: 1, stream: false }
  const baseBytes = Buffer.byteLength(JSON.stringify(body), 'utf8')
  body.messages[0].content = 'x'.repeat(CONVERSATION_MESSAGE_BYTES - baseBytes)
  expect(assertProviderRequestBudget(body)).toBe(CONVERSATION_MESSAGE_BYTES)

  for (let request = 0; request < AGGREGATE_TURN_BYTES / CONVERSATION_MESSAGE_BYTES; request++) {
    await internal.createProviderCompletion(body)
  }
  await expect(internal.createProviderCompletion(body)).rejects.toMatchObject({ code: 'AGGREGATE_REQUEST_BYTES_EXCEEDED' })

  expect(create).toHaveBeenCalledTimes(AGGREGATE_TURN_BYTES / CONVERSATION_MESSAGE_BYTES)
})

it('rejects a primary read result that cannot fit in the remaining shared byte budget', async () => {
  const agent = new Agent(
    { provider: 'local', localModel: 'test-model' },
    { simulationMode: true, logFile: null, snapshotFile: null },
  )
  agents.push(agent)
  const internal = agent as unknown as {
    turnBudgetGroupId: string
    toolMap: Map<string, { name: string; description: string; parameters: object; execute: () => Promise<string> }>
    executeTool(name: string, args: Record<string, unknown>): Promise<string>
  }
  internal.turnBudgetGroupId = 'primary-read-output-budget-test'
  internal.toolMap.set('read_file', {
    name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: {} },
    execute: async () => 'read result',
  })
  expect(agent.orchestrator.registry.recordAggregateOutputBytes(internal.turnBudgetGroupId, AGGREGATE_TURN_BYTES - 1)).toBe(true)

  const result = await internal.executeTool('read_file', {})

  expect(result).toContain('AGGREGATE_OUTPUT_BYTES_EXCEEDED')
})

it('charges custom and MCP model-facing tool results while not double-charging source-accounted Shell output', async () => {
  const agent = new Agent(
    { provider: 'local', localModel: 'test-model' },
    { simulationMode: true, logFile: null, snapshotFile: null },
  )
  agents.push(agent)
  const internal = agent as unknown as {
    turnBudgetGroupId: string
    toolMap: Map<string, { name: string; description: string; parameters: object; execute: () => Promise<string> }>
    mcpToolNames: Set<string>
    executeTool(name: string, args: Record<string, unknown>): Promise<string>
  }
  internal.turnBudgetGroupId = 'primary-custom-mcp-output-budget-test'
  const customOutput = 'custom tool output'
  for (const name of ['custom_result', 'mcp_result']) {
    internal.toolMap.set(name, {
      name, description: 'Return a result', parameters: { type: 'object', properties: {} },
      execute: async () => customOutput,
    })
  }
  internal.mcpToolNames.add('mcp_result')
  expect(agent.orchestrator.registry.recordAggregateOutputBytes(
    internal.turnBudgetGroupId, AGGREGATE_TURN_BYTES - Buffer.byteLength(customOutput, 'utf8') - 1,
  )).toBe(true)

  expect(await internal.executeTool('custom_result', {})).toBe(customOutput)
  expect(await internal.executeTool('mcp_result', {})).toContain('AGGREGATE_OUTPUT_BYTES_EXCEEDED')

  const shellAgent = new Agent(
    { provider: 'local', localModel: 'test-model' },
    { simulationMode: true, logFile: null, snapshotFile: null },
  )
  agents.push(shellAgent)
  const shellInternal = shellAgent as unknown as {
    turnBudgetGroupId: string
    toolMap: Map<string, { name: string; description: string; parameters: object; execute: (_args: Record<string, unknown>, context?: { budgetGroupId?: string; session?: { registry: { recordAggregateOutputBytes(groupId: string | undefined, bytes: number): boolean } } }) => Promise<string> }>
    executeTool(name: string, args: Record<string, unknown>): Promise<string>
  }
  shellInternal.turnBudgetGroupId = 'primary-shell-source-accounting-test'
  const shellResult = 'Shell summary is longer than the remaining three-byte allowance.'
  shellInternal.toolMap.set('shell', {
    name: 'shell', description: 'Return a Shell result', parameters: { type: 'object', properties: {} },
    execute: async (_args, context) => {
      expect(context?.session?.registry.recordAggregateOutputBytes(context.budgetGroupId, 3)).toBe(true)
      return shellResult
    },
  })
  expect(shellAgent.orchestrator.registry.recordAggregateOutputBytes(shellInternal.turnBudgetGroupId, AGGREGATE_TURN_BYTES - 3)).toBe(true)

  expect(await shellInternal.executeTool('shell', {})).toBe(shellResult)
})

it('omits a tool result when aggregate byte accounting does not return a valid acceptance', async () => {
  const agent = new Agent(
    { provider: 'local', localModel: 'test-model' },
    { simulationMode: true, logFile: null, snapshotFile: null },
  )
  agents.push(agent)
  const internal = agent as unknown as {
    turnBudgetGroupId: string
    toolMap: Map<string, { name: string; description: string; parameters: object; execute: () => Promise<string> }>
    executeTool(name: string, args: Record<string, unknown>): Promise<string>
  }
  internal.turnBudgetGroupId = 'primary-invalid-output-accounting-test'
  internal.toolMap.set('custom_result', {
    name: 'custom_result', description: 'Return a result', parameters: { type: 'object', properties: {} },
    execute: async () => 'unaccounted output',
  })
  ;(agent.orchestrator.registry as unknown as { recordAggregateOutputBytes: () => unknown }).recordAggregateOutputBytes = () => undefined

  expect(await internal.executeTool('custom_result', {})).toContain('AGGREGATE_OUTPUT_BYTES_EXCEEDED')
})

it('blocks later effectful primary calls after a rejected result while allowing read-only calls', async () => {
  const agent = new Agent(
    { provider: 'local', localModel: 'test-model' },
    { simulationMode: true, logFile: null, snapshotFile: null },
  )
  agents.push(agent)
  const internal = agent as unknown as {
    turnBudgetGroupId: string
    settings: { risk: { enabled: boolean }; permissions: { autoApproveLowRisk: boolean } }
    interactionMode: string
    allowedTools: null
    objectiveRevision: number
    turnObjectiveRevision: number
    refreshAuthorizationSettings(): Promise<boolean>
    executeTool(name: string, args: Record<string, unknown>): Promise<string>
    executeToolWithChecks(
      tc: { id: string; type: 'function'; function: { name: string; arguments: string } },
      args: Record<string, unknown>,
      callbacks: { onToolCall(name: string, args: object): void; onToolResult(name: string, result: string, args: Record<string, unknown>): void },
      lifecycle: { startedAt?: number },
    ): Promise<{ tc: { id: string }; result: string }>
  }
  internal.turnBudgetGroupId = 'primary-output-exhaustion-test'
  expect(agent.orchestrator.registry.recordAggregateOutputBytes(internal.turnBudgetGroupId, AGGREGATE_TURN_BYTES)).toBe(true)
  const executeOriginal = internal.executeTool.bind(agent)
  const rejected = await executeOriginal('introspect', {})
  expect(rejected).toContain('AGGREGATE_OUTPUT_BYTES_EXCEEDED')

  internal.settings = { risk: { enabled: false }, permissions: { autoApproveLowRisk: true } }
  internal.interactionMode = 'auto'
  internal.allowedTools = null
  internal.turnObjectiveRevision = internal.objectiveRevision
  internal.refreshAuthorizationSettings = async () => false
  const executed: string[] = []
  internal.executeTool = async name => { executed.push(name); return 'executed' }
  const callbacks = { onToolCall() {}, onToolResult() {} }
  const call = (name: string, args: Record<string, unknown>) => ({
    id: name, type: 'function' as const, function: { name, arguments: JSON.stringify(args) },
  })

  const read = await internal.executeToolWithChecks(call('introspect', {}), {}, callbacks, {})
  const status = await internal.executeToolWithChecks(call('git', { action: 'status' }), { action: 'status' }, callbacks, {})
  const list = await internal.executeToolWithChecks(call('todo', { action: 'list' }), { action: 'list' }, callbacks, {})
  const effect = await internal.executeToolWithChecks(call('shell', { command: 'echo effect' }), { command: 'echo effect' }, callbacks, {})

  expect(read.result).toBe('executed')
  expect(status.result).toBe('executed')
  expect(list.result).toBe('executed')
  expect(effect.result).toContain('AGGREGATE_OUTPUT_QUOTA_EXHAUSTED')
  expect(executed).toEqual(['introspect', 'git', 'todo'])
})

it('blocks later effects after source-accounted Shell reports an aggregate byte rejection', async () => {
  const agent = new Agent(
    { provider: 'local', localModel: 'test-model' },
    { simulationMode: true, logFile: null, snapshotFile: null },
  )
  agents.push(agent)
  const internal = agent as unknown as {
    turnBudgetGroupId: string
    toolMap: Map<string, {
      name: string; description: string; parameters: object
      execute(args: Record<string, unknown>, context?: {
        budgetGroupId?: string
        session?: { registry: { recordAggregateOutputBytes(groupId: string | undefined, bytes: number): boolean } }
      }): Promise<string>
    }>
    executeTool(name: string, args: Record<string, unknown>): Promise<string>
    executeToolWithChecks(
      tc: { id: string; type: 'function'; function: { name: string; arguments: string } },
      args: Record<string, unknown>,
      callbacks: { onToolCall(name: string, args: object): void; onToolResult(name: string, result: string, args: Record<string, unknown>): void },
      lifecycle: { startedAt?: number },
    ): Promise<{ tc: { id: string }; result: string }>
  }
  internal.turnBudgetGroupId = 'primary-shell-output-exhaustion-test'
  expect(agent.orchestrator.registry.recordAggregateOutputBytes(internal.turnBudgetGroupId, AGGREGATE_TURN_BYTES)).toBe(true)
  const shell = internal.toolMap.get('shell')!
  let executions = 0
  internal.toolMap.set('shell', {
    ...shell,
    execute: async (_args, context) => {
      executions++
      if (!context?.session) throw new Error('Shell context missing')
      expect(context.session.registry.recordAggregateOutputBytes(context.budgetGroupId, 1)).toBe(false)
      return '{"error":{"code":"AGGREGATE_OUTPUT_BYTES_EXCEEDED"}}'
    },
  })

  const result = await internal.executeTool('shell', { command: 'echo output' })
  const blocked = await internal.executeToolWithChecks(
    { id: 'later-shell', type: 'function', function: { name: 'shell', arguments: '{"command":"echo later"}' } },
    { command: 'echo later' }, { onToolCall() {}, onToolResult() {} }, {},
  )

  expect(result).toContain('AGGREGATE_OUTPUT_BYTES_EXCEEDED')
  expect(blocked.result).toContain('AGGREGATE_OUTPUT_QUOTA_EXHAUSTED')
  expect(executions).toBe(1)
})

it('records streamed usage before accepting the next primary model request', async () => {
  const agent = new Agent(
    { provider: 'local', localModel: 'test-model' },
    { simulationMode: true, logFile: null, snapshotFile: null },
  )
  agents.push(agent)
  const internal = agent as unknown as { orchestrator: { configure(input: { limits: { maxAggregateTokens: number } }): void }; turnBudgetGroupId: string; createProviderCompletion(body: Record<string, unknown>): Promise<AsyncIterable<any>> }
  internal.orchestrator.configure({ limits: { maxAggregateTokens: 5 } })
  internal.turnBudgetGroupId = 'primary-stream-budget-test'
  const create = mock(async (_request: Record<string, unknown>) => (async function* () {
    yield { choices: [{ delta: { content: 'answer' }, finish_reason: 'stop' }] }
    yield { choices: [], usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 } }
  })())
  ;(agent as unknown as Record<string, any>).client = { chat: { completions: { create } } }

  const response = await internal.createProviderCompletion({ model: 'test-model', messages: [], max_tokens: 20, stream: true })
  for await (const _chunk of response) { /* consume through the final usage chunk */ }
  await expect(internal.createProviderCompletion({ model: 'test-model', messages: [], max_tokens: 20, stream: false }))
    .rejects.toMatchObject({ code: 'AGGREGATE_BUDGET_EXHAUSTED' })

  expect(create.mock.calls[0]?.[0].max_tokens).toBe(5)
  expect(create).toHaveBeenCalledTimes(1)
})

it('caps primary output by aggregate cost when the provider price is verified', async () => {
  const provider = { provider: 'deepseek' as const, baseURL: 'https://api.deepseek.com', apiKey: 'test-key' }
  const perOutputToken = estimateCost('deepseek-flash', { promptTokens: 0, completionTokens: 1, cachedTokens: 0 })
  const agent = new Agent(provider, { simulationMode: true, logFile: null, snapshotFile: null })
  agents.push(agent)
  const internal = agent as unknown as { orchestrator: { configure(input: { limits: { maxAggregateCostUsd: number } }): void }; turnBudgetGroupId: string; createProviderCompletion(body: Record<string, unknown>): Promise<any> }
  internal.orchestrator.configure({ limits: { maxAggregateCostUsd: perOutputToken * 3.2 } })
  internal.turnBudgetGroupId = 'primary-cost-budget-test'
  const create = mock(async (_request: Record<string, unknown>) => ({
    choices: [{ message: { content: 'answer' } }],
    usage: { total_tokens: 3, prompt_tokens: 0, completion_tokens: 3 },
  }))
  ;(agent as unknown as Record<string, any>).client = { chat: { completions: { create } } }

  await internal.createProviderCompletion({ model: 'deepseek-flash', messages: [], max_tokens: 20, stream: false })

  expect(create.mock.calls[0]?.[0].max_tokens).toBe(3)
})

it('blocks the next primary request when aggregate token usage is unavailable', async () => {
  const agent = new Agent(
    { provider: 'local', localModel: 'test-model' },
    { simulationMode: true, logFile: null, snapshotFile: null },
  )
  agents.push(agent)
  const internal = agent as unknown as { orchestrator: { configure(input: { limits: { maxAggregateTokens: number } }): void }; turnBudgetGroupId: string; createProviderCompletion(body: Record<string, unknown>): Promise<any> }
  internal.orchestrator.configure({ limits: { maxAggregateTokens: 5 } })
  internal.turnBudgetGroupId = 'primary-unmeasured-budget-test'
  const create = mock(async (_request: Record<string, unknown>) => ({ choices: [{ message: { content: 'unmeasured answer' } }] }))
  ;(agent as unknown as Record<string, any>).client = { chat: { completions: { create } } }

  await expect(internal.createProviderCompletion({ model: 'test-model', messages: [], max_tokens: 5, stream: false }))
    .rejects.toMatchObject({ code: 'AGGREGATE_BUDGET_UNAVAILABLE' })
  await expect(internal.createProviderCompletion({ model: 'test-model', messages: [], max_tokens: 5, stream: false }))
    .rejects.toMatchObject({ code: 'AGGREGATE_BUDGET_UNAVAILABLE' })
  expect(create).toHaveBeenCalledTimes(1)
})

it('keeps prompt-refiner preview callable after the previous turn byte budget is exhausted', async () => {
  const agent = new Agent(
    { provider: 'local', localModel: 'test-model' },
    { simulationMode: true, logFile: null, snapshotFile: null },
  )
  agents.push(agent)
  ;(agent as unknown as Record<string, unknown>).readyPromise = Promise.resolve()
  ;(agent as unknown as Record<string, any>).settings = { promptRefiner: { model: 'refiner-model', minimumLength: 30 } }
  const internal = agent as unknown as {
    turnBudgetGroupId: string
    createProviderCompletion(body: Record<string, unknown>): Promise<any>
  }
  internal.turnBudgetGroupId = 'preview-after-exhausted-turn'
  expect(agent.orchestrator.registry.recordAggregateOutputBytes(internal.turnBudgetGroupId, AGGREGATE_TURN_BYTES)).toBe(true)

  const create = mock(async (_request: Record<string, unknown>, _options?: { signal?: AbortSignal }) => ({ choices: [{ message: { content: 'Add a concise success criterion.' } }] }))
  ;(agent as unknown as Record<string, any>).client = { chat: { completions: { create } } }

  const preview = await agent.previewPromptRefiner('Implement a small feature with clear observable behavior.')
  expect(preview.status).toBe('refined')
  expect(create).toHaveBeenCalledTimes(1)
  expect(create.mock.calls[0]?.[1]).toBeUndefined()

  await expect(internal.createProviderCompletion({ model: 'test-model', messages: [], max_tokens: 1, stream: false }))
    .rejects.toMatchObject({ code: 'AGGREGATE_REQUEST_BYTES_EXCEEDED' })
  expect(create).toHaveBeenCalledTimes(1)
})

it('keeps prompt-refiner preview independent of an aborted prior-turn signal and byte ledger', async () => {
  const prompt = 'Implement a small feature with clear observable behavior.'
  const expectedRequests: Record<string, unknown>[] = []
  const requestCaptureClient = {
    chat: { completions: { create: async (request: Record<string, unknown>) => {
      expectedRequests.push(structuredClone(request))
      return { choices: [{ message: { content: 'Add a concise success criterion.' } }] }
    } } },
  } as unknown as OpenAI
  await previewPromptRefinement(requestCaptureClient, 'refiner-model', prompt, 30)
  const previewRequest = expectedRequests[0]!
  const previewRequestBytes = assertProviderRequestBudget(previewRequest)

  const agent = new Agent(
    { provider: 'local', localModel: 'test-model' },
    { simulationMode: true, logFile: null, snapshotFile: null },
  )
  agents.push(agent)
  ;(agent as unknown as Record<string, unknown>).readyPromise = Promise.resolve()
  ;(agent as unknown as Record<string, any>).settings = { promptRefiner: { model: 'refiner-model', minimumLength: 30 } }
  const controller = new AbortController()
  controller.abort(new Error('previous turn ended'))
  const internal = agent as unknown as {
    turnBudgetGroupId: string
    abortController: AbortController | null
    createProviderCompletion(body: Record<string, unknown>): Promise<any>
  }
  internal.turnBudgetGroupId = 'preview-after-aborted-turn'
  internal.abortController = controller
  expect(agent.orchestrator.registry.recordAggregateOutputBytes(internal.turnBudgetGroupId, AGGREGATE_TURN_BYTES - previewRequestBytes)).toBe(true)

  const create = mock(async (_request: Record<string, unknown>, _options?: { signal?: AbortSignal }) => ({ choices: [{ message: { content: 'Add a concise success criterion.' } }] }))
  ;(agent as unknown as Record<string, any>).client = { chat: { completions: { create } } }

  const preview = await agent.previewPromptRefiner(prompt)
  expect(preview.status).toBe('refined')
  expect(create).toHaveBeenCalledTimes(1)
  expect(create.mock.calls[0]?.[1]).toBeUndefined()

  internal.abortController = null
  await internal.createProviderCompletion(previewRequest)
  expect(create).toHaveBeenCalledTimes(2)
})

it('rejects an oversized non-streaming tool response before executing or emitting it', async () => {
  const original = process.env.DEEPSEEK_NO_STREAM
  process.env.DEEPSEEK_NO_STREAM = '1'
  const agent = new Agent(
    { provider: 'vertex', gcpProject: 'test', gcpLocation: 'global', gcpCredentials: '/tmp/test-service-account.json' },
    { simulationMode: true, logFile: null, snapshotFile: null },
  )
  agents.push(agent)
  ;(agent as unknown as Record<string, unknown>).readyPromise = Promise.resolve()
  ;(agent as unknown as Record<string, unknown>).settings = { risk: { enabled: false }, permissions: { autoApproveLowRisk: true } }
  const execute = mock(async () => 'unexpected execution')
  ;(agent as unknown as Record<string, unknown>).executeTool = execute
  const create = mock(async () => ({
    choices: [{
      finish_reason: 'tool_calls',
      message: { content: null, tool_calls: [{ id: 'oversized', type: 'function', function: { name: 'read_file', arguments: 'x'.repeat(CONVERSATION_MESSAGE_BYTES + 1) } }] },
    }],
  }))
  ;(agent as unknown as Record<string, unknown>).client = { chat: { completions: { create } } }
  const emitted: string[] = []

  try {
    await expect(agent.run('inspect a file', {
      onToken: text => emitted.push(text), onToolCall() {}, onToolResult() {}, onDone() {},
    })).rejects.toMatchObject({ name: 'StreamOutputLimitError', maxBytes: CONVERSATION_MESSAGE_BYTES })
    expect(execute).not.toHaveBeenCalled()
    expect(emitted).toEqual([])
  } finally {
    if (original === undefined) delete process.env.DEEPSEEK_NO_STREAM
    else process.env.DEEPSEEK_NO_STREAM = original
  }
})
