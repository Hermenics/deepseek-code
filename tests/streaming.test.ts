import { describe, it, expect, mock, beforeAll, afterAll } from 'bun:test'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Agent } from '../src/agent/agent.js'
import type { AgentCallbacks } from '../src/agent/agent.js'
import { CONVERSATION_MESSAGE_BYTES } from '../src/agent/toolOutputBudget.js'
import type { ProviderConfig } from '../src/ui/setup/ApiKeySetup.js'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const TEST_HISTORY_PATH = join(tmpdir(), `deepseek-code-streaming-history-${process.pid}.json`)
const ORIGINAL_HISTORY_PATH = process.env.DEEPSEEK_HISTORY_PATH

beforeAll(() => {
  process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-key-for-unit-tests'
  process.env.DEEPSEEK_HISTORY_PATH = TEST_HISTORY_PATH
})

afterAll(async () => {
  if (ORIGINAL_HISTORY_PATH === undefined) delete process.env.DEEPSEEK_HISTORY_PATH
  else process.env.DEEPSEEK_HISTORY_PATH = ORIGINAL_HISTORY_PATH
  await rm(TEST_HISTORY_PATH, { force: true })
})

/** Inject a mocked client into Agent via a cast (same pattern as agent.test.ts). */
function injectMockClient(agent: Agent, clientMock: object) {
  ;(agent as unknown as Record<string, unknown>).client = clientMock
}

/** Wait for Agent initialization to finish. */
async function resolveReady(agent: Agent) {
  await agent.readyPromise
}

/** Create an async iterable from chunks. */
async function* makeStream(chunks: object[]) {
  for (const chunk of chunks) {
    yield chunk
  }
}

/** Create callbacks with observable internal state. */
function makeTrackedCallbacks(): AgentCallbacks & {
  tokens: string[]
  toolCalls: Array<{ name: string; args: object }>
  toolResults: Array<{ name: string; result: string; args: Record<string, unknown> }>
  doneCount: number
} {
  const state = {
    tokens: [] as string[],
    toolCalls: [] as Array<{ name: string; args: object }>,
    toolResults: [] as Array<{ name: string; result: string; args: Record<string, unknown> }>,
    doneCount: 0,
  }
  return {
    get tokens() { return state.tokens },
    get toolCalls() { return state.toolCalls },
    get toolResults() { return state.toolResults },
    get doneCount() { return state.doneCount },
    onToken(text: string) { state.tokens.push(text) },
    onToolCall(name: string, args: object) { state.toolCalls.push({ name, args }) },
    onToolResult(name: string, result: string, args: Record<string, unknown>) {
      state.toolResults.push({ name, result, args })
    },
    onDone() { state.doneCount++ },
  }
}

/** Create a mock tool to inject into Agent's toolMap. */
function makeToolMock(name: string, result: string) {
  const argumentName = name === 'shell' ? 'command' : name === 'grep' || name === 'glob' ? 'pattern' : 'path'
  return {
    name,
    description: `Mock tool: ${name}`,
    parameters: { type: 'object', properties: { [argumentName]: { type: 'string' } } },
    execute: mock(() => Promise.resolve(result)),
  }
}

/** Inject a mocked tool into Agent's toolMap. */
function injectTool(agent: Agent, tool: ReturnType<typeof makeToolMock>) {
  const toolMap = (agent as unknown as Record<string, unknown>).toolMap as Map<string, unknown>
  toolMap.set(tool.name, tool)
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaming tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent streaming callbacks', () => {

  describe('micro-compaction callback', () => {
    it('reports freed tokens only when enhanced micro-compaction changed messages', async () => {
      const agent = new Agent()
      await resolveReady(agent)
      ;(agent as any).messages = [
        {
          role: 'assistant',
          content: null,
          tool_calls: Array.from({ length: 9 }, (_, i) => ({
            id: String(i),
            type: 'function',
            function: { name: 'read_file', arguments: '{}' },
          })),
        },
        ...Array.from({ length: 9 }, (_, i) => ({ role: 'tool', content: 'x'.repeat(300), tool_call_id: String(i) })),
      ]
      injectMockClient(agent, {
        chat: { completions: { create: mock(() => makeStream([{ choices: [{ delta: { content: 'done' } }] }])) } },
      })

      const freed: number[] = []
      const cb = makeTrackedCallbacks()
      await agent.run('hello', { ...cb, onMicroCompact: (details) => freed.push(details.freedTokensEstimate) })
      expect(freed[0]).toBeGreaterThan(0)

      ;(agent as any).messages = []
      freed.length = 0
      await agent.run('again', { ...cb, onMicroCompact: (details) => freed.push(details.freedTokensEstimate) })
      expect(freed).toEqual([])
    })
  })

  // ── 1. Happy path ──────────────────────────────────────────────────────────
  describe('onToken — happy path', () => {
    it('should call onToken 3 times with correct text when stream has 3 text chunks', async () => {
      // Arrange
      const agent = new Agent()
      await resolveReady(agent)

      const chunks = [
        { choices: [{ delta: { content: 'Hello' } }] },
        { choices: [{ delta: { content: ' mundo' } }] },
        { choices: [{ delta: { content: '!' } }] },
      ]

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock(() => makeStream(chunks)),
          },
        },
      })

      const cb = makeTrackedCallbacks()

      // Act
      await agent.run('hello', cb)

      // Assert
      expect(cb.tokens).toHaveLength(3)
      expect(cb.tokens[0]).toBe('Hello')
      expect(cb.tokens[1]).toBe(' mundo')
      expect(cb.tokens[2]).toBe('!')
    })
  })

  // ── 2. Empty delta.content ─────────────────────────────────────────────────
  describe('onToken — empty delta', () => {
    it('should NOT call onToken when delta.content is empty string', async () => {
      // Arrange
      const agent = new Agent()
      await resolveReady(agent)

      const chunks = [
        { choices: [{ delta: { content: '' } }] },
        { choices: [{ delta: { content: '' } }] },
      ]

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock(() => makeStream(chunks)),
          },
        },
      })

      const cb = makeTrackedCallbacks()

      // Act
      await agent.run('hello', cb)

      // Assert
      expect(cb.tokens).toHaveLength(0)
    })
  })

  // ── 3. Null delta.content ──────────────────────────────────────────────────
  describe('onToken — null delta', () => {
    it('should NOT call onToken when delta.content is null', async () => {
      // Arrange
      const agent = new Agent()
      await resolveReady(agent)

      const chunks = [
        { choices: [{ delta: { content: null } }] },
      ]

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock(() => makeStream(chunks)),
          },
        },
      })

      const cb = makeTrackedCallbacks()

      // Act
      await agent.run('hello', cb)

      // Assert
      expect(cb.tokens).toHaveLength(0)
    })
  })

  // ── 4. Usage-only chunk (choices: []) ─────────────────────────────────────
  describe('usage-only chunk', () => {
    it('should not crash and not call onToken when chunk has empty choices and usage present', async () => {
      // Arrange
      const agent = new Agent()
      await resolveReady(agent)

      const chunks = [
        { choices: [{ delta: { content: 'text' } }] },
        // Usage-only chunk without choices — the DeepSeek stream_options format.
        {
          choices: [],
          usage: { total_tokens: 10, prompt_tokens: 5, completion_tokens: 5 },
        },
      ]

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock(() => makeStream(chunks)),
          },
        },
      })

      const cb = makeTrackedCallbacks()

      // Act — should not throw.
      await agent.run('hello', cb)

      // Assert — only the chunk with actual content triggers onToken.
      expect(cb.tokens).toHaveLength(1)
      expect(cb.tokens[0]).toBe('text')
      expect(cb.doneCount).toBe(1)
    })
  })

  // ── 5. Tool call — onToolCall fires with the correct name and args ─────────
  describe('onToolCall', () => {
    it('should call onToolCall with correct name and parsed args before execution', async () => {
      // Arrange
      const agent = new Agent()
      await resolveReady(agent)

      const toolArgs = { path: 'test.txt' }

      // Simulate a complete tool call stream (args arrive in separate chunks).
      const chunks = [
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_abc123',
                function: { name: 'read_file', arguments: '' },
              }],
            },
          }],
        },
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                function: { arguments: JSON.stringify(toolArgs) },
              }],
            },
          }],
        },
      ]

      // Mock read_file so it does not touch the filesystem.
      const readFileMock = makeToolMock('read_file', 'file contents')
      injectTool(agent, readFileMock)

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock()
              // First call: stream with a tool call.
              .mockImplementationOnce(() => makeStream(chunks))
              // Second call: final response stream (no more tool calls).
              .mockImplementationOnce(() => makeStream([
                { choices: [{ delta: { content: 'File read.' } }] },
              ])),
          },
        },
      })

      const cb = makeTrackedCallbacks()

      // Act
      await agent.run('read the file', cb)

      // Assert — onToolCall should have been called with the correct name.
      expect(cb.toolCalls).toHaveLength(1)
      expect(cb.toolCalls[0]!.name).toBe('read_file')
      expect(cb.toolCalls[0]!.args).toEqual(toolArgs)
    })
  })

  // ── 6. Tool result — onToolResult fires after execution ───────────────────
  describe('onToolResult', () => {
    it('should call onToolResult with correct result after tool execution', async () => {
      // Arrange
      const agent = new Agent()
      await resolveReady(agent)

      const toolArgs = { path: 'test.txt' }
      const expectedResult = 'mocked file contents'

      const chunks = [
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_xyz789',
                function: { name: 'read_file', arguments: JSON.stringify(toolArgs) },
              }],
            },
          }],
        },
      ]

      const readFileMock = makeToolMock('read_file', expectedResult)
      injectTool(agent, readFileMock)

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock()
              .mockImplementationOnce(() => makeStream(chunks))
              .mockImplementationOnce(() => makeStream([
                { choices: [{ delta: { content: 'Pronto.' } }] },
              ])),
          },
        },
      })

      const cb = makeTrackedCallbacks()

      // Act
      await agent.run('read the file', cb)

      // Assert
      expect(cb.toolResults).toHaveLength(1)
      expect(cb.toolResults[0]!.name).toBe('read_file')
      expect(cb.toolResults[0]!.result).toBe(expectedResult)
      expect(cb.toolResults[0]!.args).toEqual(toolArgs)
    })
  })

  // ── 7. Mixed: text → tool call → text — correct order ─────────────────────
  describe('mixed stream — text, tool call, text', () => {
    it('should fire all callbacks in correct order: onToken, onToolCall, onToolResult, onToken, onDone', async () => {
      // Arrange
      const agent = new Agent()
      await resolveReady(agent)

      const callOrder: string[] = []

      const toolArgs = { command: 'ls' }
      const toolResult = 'file1.txt\nfile2.txt'

      // First loop iteration: text + tool call.
      const firstStream = [
        { choices: [{ delta: { content: 'I will list the files.' } }] },
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_mix001',
                function: { name: 'shell', arguments: JSON.stringify(toolArgs) },
              }],
            },
          }],
        },
      ]

      // Second loop iteration: final text.
      const secondStream = [
        { choices: [{ delta: { content: 'Listing complete.' } }] },
      ]

      const shellMock = makeToolMock('shell', toolResult)
      injectTool(agent, shellMock)

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock()
              .mockImplementationOnce(() => makeStream(firstStream))
              .mockImplementationOnce(() => makeStream(secondStream)),
          },
        },
      })

      const cb: AgentCallbacks = {
        onToken(text) { callOrder.push(`token:${text}`) },
        onToolCall(name) { callOrder.push(`toolCall:${name}`) },
        onToolResult(name) { callOrder.push(`toolResult:${name}`) },
        onDone() { callOrder.push('done') },
      }

      // Act
      await agent.run('list the files', cb)

      // Assert — exact event order.
      expect(callOrder[0]).toBe('token:I will list the files.')
      expect(callOrder[1]).toBe('toolCall:shell')
      expect(callOrder[2]).toBe('toolResult:shell')
      expect(callOrder[3]).toBe('token:Listing complete.')
      expect(callOrder[4]).toBe('done')
    }, 15_000)
  })

  // ── 8. Abort mid-stream — onDone is called without crashing ────────────────
  describe('abort mid-stream', () => {
    it('should call onDone and not crash when abort is called after first token', async () => {
      // Arrange
      const agent = new Agent()
      await resolveReady(agent)

      const cb = makeTrackedCallbacks()

      // Abort the stream after the first chunk.
      async function* abortingStream() {
        yield { choices: [{ delta: { content: 'First token' } }] }
        // Simulate AbortController being triggered during iteration.
        agent.abort()
        // Throw the error generated by AbortController.
        const err = new Error('The operation was aborted.')
        ;(err as unknown as Record<string, unknown>).name = 'AbortError'
        throw err
      }

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock(() => abortingStream()),
          },
        },
      })

      // Act — should not throw.
      await agent.run('hello', cb)

      // Assert
      expect(cb.doneCount).toBe(1)
      expect(cb.tokens[0]).toBe('First token')
    })
  })

  // ── 9. onDone is always called on the happy path ───────────────────────────
  describe('onDone', () => {
    it('should call onDone exactly once after a simple text stream', async () => {
      // Arrange
      const agent = new Agent()
      await resolveReady(agent)

      const chunks = [
        { choices: [{ delta: { content: 'Complete response.' } }] },
      ]

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock(() => makeStream(chunks)),
          },
        },
      })

      const cb = makeTrackedCallbacks()

      // Act
      await agent.run('hello', cb)

      // Assert
      expect(cb.doneCount).toBe(1)
    })
  })

  // ── OAuth: truncate multiple tool calls to single ───────────────────────────
  // [OAUTH-DISABLED] Skipped — OAuth feature temporarily disabled
  describe.skip('OAuth tool truncation', () => {
    it('should execute only the first tool call when provider is oauth and multiple tools are returned', async () => {
      // [OAUTH-DISABLED] cast needed because 'oauth' was removed from ProviderName
      const agent = new Agent({ provider: 'oauth', proxyApiKey: 'test-proxy-key' } as unknown as ProviderConfig)
      await resolveReady(agent)

      const chunks = [
        {
          choices: [{
            delta: {
              tool_calls: [
                { index: 0, id: 'call_first', function: { name: 'read_file', arguments: JSON.stringify({ path: '/a.txt' }) } },
                { index: 1, id: 'call_second', function: { name: 'read_folder', arguments: JSON.stringify({ path: '/src' }) } },
                { index: 2, id: 'call_third', function: { name: 'grep', arguments: JSON.stringify({ pattern: 'foo' }) } },
              ],
            },
          }],
        },
      ]

      const readFileMock = makeToolMock('read_file', 'file content')
      const readFolderMock = makeToolMock('read_folder', 'folder listing')
      const grepMock = makeToolMock('grep', 'grep results')
      injectTool(agent, readFileMock)
      injectTool(agent, readFolderMock)
      injectTool(agent, grepMock)

      let callCount = 0
      injectMockClient(agent, {
        chat: {
          completions: {
            create: () => {
              callCount++
              if (callCount === 1) return makeStream(chunks)
              return makeStream([{ choices: [{ delta: { content: 'Done.' } }] }])
            },
          },
        },
      })

      const cb = makeTrackedCallbacks()

      await agent.run('read everything', cb)

      // Only the first tool should have been executed
      expect(readFileMock.execute).toHaveBeenCalledTimes(1)
      expect(readFolderMock.execute).not.toHaveBeenCalled()
      expect(grepMock.execute).not.toHaveBeenCalled()

      // onToolCall should only fire once
      expect(cb.toolCalls).toHaveLength(1)
      expect(cb.toolCalls[0]!.name).toBe('read_file')
    })

    it('should append skipped tools notification to tool result message', async () => {
      // [OAUTH-DISABLED] cast needed because 'oauth' was removed from ProviderName
      const agent = new Agent({ provider: 'oauth', proxyApiKey: 'test-proxy-key' } as unknown as ProviderConfig)
      // Wait for real initialization to complete (prevents race with messages reset)
      await (agent as any).readyPromise

      const chunks = [
        {
          choices: [{
            delta: {
              tool_calls: [
                { index: 0, id: 'call_a', function: { name: 'read_file', arguments: JSON.stringify({ path: '/x.ts' }) } },
                { index: 1, id: 'call_b', function: { name: 'glob', arguments: JSON.stringify({ pattern: '*.ts' }) } },
              ],
            },
          }],
        },
      ]

      const readFileMock = makeToolMock('read_file', 'content of x.ts')
      const globMock = makeToolMock('glob', 'glob results')
      injectTool(agent, readFileMock)
      injectTool(agent, globMock)

      let callCount = 0
      injectMockClient(agent, {
        chat: {
          completions: {
            create: () => {
              callCount++
              if (callCount === 1) return makeStream(chunks)
              return makeStream([{ choices: [{ delta: { content: 'OK.' } }] }])
            },
          },
        },
      })

      const cb = makeTrackedCallbacks()
      await agent.run('find files', cb)

      // Check that the tool result contains the skipped notification
      const messages = (agent as any).messages
      const toolMsg = messages.find((m: any) => m.role === 'tool' && m.tool_call_id === 'call_a')
      expect(toolMsg).toBeDefined()
      expect(toolMsg.content).toContain('[System: You called 2 tools at once')
      expect(toolMsg.content).toContain('glob')
    })

    it('should NOT truncate when provider is not oauth', async () => {
      const agent = new Agent({ provider: 'deepseek', apiKey: 'test-key' })
      await resolveReady(agent)

      const chunks = [
        {
          choices: [{
            delta: {
              tool_calls: [
                { index: 0, id: 'call_1', function: { name: 'read_file', arguments: JSON.stringify({ path: '/a.txt' }) } },
                { index: 1, id: 'call_2', function: { name: 'read_folder', arguments: JSON.stringify({ path: '/src' }) } },
              ],
            },
          }],
        },
      ]

      const readFileMock = makeToolMock('read_file', 'file a')
      const readFolderMock = makeToolMock('read_folder', 'folder src')
      injectTool(agent, readFileMock)
      injectTool(agent, readFolderMock)

      let callCount = 0
      injectMockClient(agent, {
        chat: {
          completions: {
            create: () => {
              callCount++
              if (callCount === 1) return makeStream(chunks)
              return makeStream([{ choices: [{ delta: { content: 'Both done.' } }] }])
            },
          },
        },
      })

      const cb = makeTrackedCallbacks()
      await agent.run('read both', cb)

      // Both tools should execute (parallel safe)
      expect(readFileMock.execute).toHaveBeenCalledTimes(1)
      expect(readFolderMock.execute).toHaveBeenCalledTimes(1)
      expect(cb.toolCalls).toHaveLength(2)
    })
  })
})

describe('Agent tool-call error boundary', () => {
  it('enforces write denials for Bedrock native tool calls', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-bedrock-native-authorization-'))
    const agent = new Agent(
      { provider: 'bedrock', model: 'us.deepseek.v3.2-v1:0', awsRegion: 'us-east-1' },
      { projectRoot: root, logFile: null, snapshotFile: null },
    )
    await agent.readyPromise.catch(() => {})
    ;(agent as any).settings = { risk: { enabled: false }, permissions: { deny: ['WriteFile(*)'] } }
    const executed: string[] = []
    ;(agent as any).executeTool = async (name: string) => { executed.push(name); return 'unexpected effect' }
    let requests = 0
    injectMockClient(agent, {
      chat: { completions: { create: (body: { stream?: boolean }) => {
        if (!body.stream) return Promise.resolve({ choices: [{ message: { content: '{"kind":"none","fact":""}' } }] })
        return ++requests === 1
          ? makeStream([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'blocked-write', function: { name: 'write_file', arguments: '{"path":"blocked.txt","content":"must not be written"}' } }] } }] }])
          : makeStream([{ choices: [{ delta: { content: 'done' } }] }])
      } } },
    })

    try {
      const cb = makeTrackedCallbacks()
      await agent.run('write a file', cb)

      expect(executed).toEqual([])
      expect(cb.toolResults.some(({ result }) => result.includes('blocked by permission rule'))).toBe(true)
      expect(requests).toBe(2)
    } finally {
      await agent.shutdown()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('enforces write denials for Bedrock prompt-based tool calls', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-bedrock-authorization-'))
    const agent = new Agent(
      { provider: 'bedrock', model: 'us.deepseek.r1-v1:0', awsRegion: 'us-east-1' },
      { projectRoot: root, logFile: null, snapshotFile: null },
    )
    await agent.readyPromise.catch(() => {})
    ;(agent as any).settings = { risk: { enabled: false }, permissions: { deny: ['WriteFile(*)'] } }
    const executed: string[] = []
    ;(agent as any).executeTool = async (name: string) => { executed.push(name); return 'unexpected effect' }
    let requests = 0
    injectMockClient(agent, {
      chat: { completions: { create: (body: { stream?: boolean }) => {
        if (!body.stream) return Promise.resolve({ choices: [{ message: { content: '{"kind":"none","fact":""}' } }] })
        return ++requests === 1
          ? makeStream([{ choices: [{ delta: { content: '<tool_call><name>write_file</name><args>{"path":"blocked.txt","content":"must not be written"}</args></tool_call>' } }] }])
          : makeStream([{ choices: [{ delta: { content: 'done' } }] }])
      } } },
    })

    try {
      const cb = makeTrackedCallbacks()
      await agent.run('write a file', cb)

      expect(executed).toEqual([])
      expect(cb.toolResults.some(({ result }) => result.includes('blocked by permission rule'))).toBe(true)
      expect(requests).toBe(2)
    } finally {
      await agent.shutdown()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('caps Bedrock prompt-tool results together with the retained call block', async () => {
    const agent = new Agent({ provider: 'bedrock', model: 'us.deepseek.r1-v1:0', awsRegion: 'us-east-1' })
    await agent.readyPromise.catch(() => {})
    ;(agent as any).settings = { risk: { enabled: false }, permissions: { autoApproveLowRisk: true } }
    const executed: string[] = []
    ;(agent as any).executeTool = async (name: string) => { executed.push(name); return 'large-result-'.repeat(5_000) }
    let requests = 0
    injectMockClient(agent, {
      chat: { completions: { create: (body: { stream?: boolean }) => {
        if (!body.stream) return Promise.resolve({ choices: [{ message: { content: '{"kind":"none","fact":""}' } }] })
        return ++requests === 1
          ? makeStream([{ choices: [{ delta: { content: '<tool_call><name>read_file</name><args>{"path":"README.md"}</args></tool_call>' } }] }])
          : makeStream([{ choices: [{ delta: { content: 'done' } }] }])
      } } },
    })

    await agent.run('inspect the README', makeTrackedCallbacks())

    const assistant = (agent as any).messages.find((message: any) => message.role === 'assistant' && message.content?.includes('<tool_call>'))
    const callBlock = assistant.content.match(/<tool_call>[\s\S]*?<\/tool_call>/)?.[0]
    const results = (agent as any).messages.filter((message: any) => message.role === 'user' && message.content?.includes('<tool_result>'))
    expect(executed).toEqual(['read_file'])
    expect(callBlock).toBeDefined()
    expect(results).toHaveLength(1)
    expect(Buffer.byteLength(callBlock!, 'utf8') + Buffer.byteLength(JSON.stringify(results), 'utf8')).toBeLessThanOrEqual(40_000)
    expect(results[0]!.content).toContain('[Batch output budget exhausted; recover source using session_evidence.]')
    expect(results[0]!.content).toEndWith('</tool_result>')
    await agent.shutdown()
  })

  it('stops a streaming tool batch at the shared UTF-8 argument cap and drops later payloads from history', async () => {
    const agent = new Agent({ provider: 'deepseek', apiKey: 'test-key' })
    await agent.readyPromise.catch(() => {})
    ;(agent as any).settings = { risk: { enabled: false }, permissions: { autoApproveLowRisk: true } }
    const executed: string[] = []
    ;(agent as any).executeTool = async (name: string) => { executed.push(name); return 'mock result' }

    const calls = [
      { index: 0, id: 'call_within_budget', function: { name: 'write_file', arguments: JSON.stringify({ path: 'first.txt', content: 'a'.repeat(25_000) }) } },
      { index: 1, id: 'call_over_budget', function: { name: 'write_file', arguments: JSON.stringify({ path: 'second.txt', content: `${'b'.repeat(14_960)}INPUT_SENTINEL` }) } },
      { index: 2, id: 'call_after_overflow', function: { name: 'read_file', arguments: JSON.stringify({ path: 'README.md' }) } },
    ]
    let requests = 0
    injectMockClient(agent, {
      chat: { completions: { create: (body: { stream?: boolean }) => {
        if (!body.stream) return Promise.resolve({ choices: [{ message: { content: '{"kind":"none","fact":""}' } }] })
        return ++requests === 1
          ? makeStream([{ choices: [{ delta: { tool_calls: calls } }] }])
          : makeStream([{ choices: [{ delta: { content: 'done' } }] }])
      } } },
    })

    const cb = makeTrackedCallbacks()
    await agent.run('write the smaller first file and inspect README', cb)

    expect(executed).toEqual(['write_file'])
    expect(cb.toolResults[1]!.result).toContain('40000-byte UTF-8 round-trip budget')
    expect(cb.toolResults[2]!.result).toContain('earlier tool call exceeded')
    const storedCallMessage = (agent as any).messages.find((message: any) => message.role === 'assistant' && Array.isArray(message.tool_calls))
    expect(storedCallMessage.tool_calls[1].function.arguments).toBe('{}')
    expect(storedCallMessage.tool_calls[2].function.arguments).toBe('{}')
    expect(JSON.stringify(storedCallMessage)).not.toContain('INPUT_SENTINEL')
    await agent.shutdown()
  })

  it('bounds aggregate UTF-8 stream output before appending reasoning, text, or tool arguments', async () => {
    const agent = new Agent({ provider: 'deepseek', apiKey: 'test-key' })
    await agent.readyPromise.catch(() => {})
    const content = 'é'.repeat(1024 * 1024)
    const id = 'call'
    const name = 'read_file'
    const firstArguments = 'a'.repeat(16)
    const reasoning = 'r'.repeat(CONVERSATION_MESSAGE_BYTES - Buffer.byteLength(content) - Buffer.byteLength(id) - Buffer.byteLength(name) - Buffer.byteLength(firstArguments))
    let upstreamClosed = false
    async function* oversizedStream() {
      try {
        yield { choices: [{ delta: { content } }] }
        yield { choices: [{ delta: { reasoning_content: reasoning } }] }
        yield { choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: firstArguments } }] } }] }
        yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'b' } }] } }] }
      } finally {
        upstreamClosed = true
      }
    }
    injectMockClient(agent, { chat: { completions: { create: mock(() => oversizedStream()) } } })

    const callbacks = makeTrackedCallbacks()
    const thinking: string[] = []
    const pending: string[] = []
    await expect(agent.run('return a large response', {
      ...callbacks,
      onThinking: text => thinking.push(text),
      onToolPending: (_name, argsText) => pending.push(argsText),
    })).rejects.toMatchObject({
      name: 'StreamOutputLimitError',
      maxBytes: CONVERSATION_MESSAGE_BYTES,
    })

    expect(upstreamClosed).toBe(true)
    expect(callbacks.tokens).toHaveLength(1)
    expect(thinking).toHaveLength(1)
    expect(pending).toEqual([firstArguments])
    expect(callbacks.doneCount).toBe(0)
    await agent.shutdown()
  })

  it('continues a sequential batch after a tool failure and answers every call', async () => {
    const agent = new Agent({ provider: 'deepseek', apiKey: 'test-key' })
    // Let the constructor's initialize() finish: it resets messages, and when that lands mid-turn it
    // silently drops the assistant tool-call message and hides the auto-memory request below.
    await agent.readyPromise.catch(() => {})
    ;(agent as any).settings = { risk: { enabled: false }, permissions: { autoApproveLowRisk: true } }
    const executed: string[] = []
    ;(agent as any).executeTool = async (name: string) => {
      executed.push(name)
      if (name === 'write_file') throw new Error('write failed')
      return 'second result'
    }

    const chunks = [{
      choices: [{
        delta: {
          tool_calls: [
            { index: 0, id: 'call_failed', function: { name: 'write_file', arguments: JSON.stringify({ path: 'failed.txt', content: 'x' }) } },
            { index: 1, id: 'call_ok', function: { name: 'read_file', arguments: JSON.stringify({ path: 'README.md' }) } },
          ],
        },
      }],
    }]
    let requests = 0
    injectMockClient(agent, {
      chat: { completions: { create: (body: { stream?: boolean }) => {
        // Non-streaming calls are the background auto-memory extraction, not the agent loop.
        if (!body.stream) return Promise.resolve({ choices: [{ message: { content: '{"kind":"none","fact":""}' } }] })
        return ++requests === 1
          ? makeStream(chunks)
          : makeStream([{ choices: [{ delta: { content: 'done' } }] }])
      } } },
    })

    const cb = makeTrackedCallbacks()
    await agent.run('run both', cb)

    expect(executed).toEqual(['write_file', 'read_file'])
    expect(requests).toBe(2)
    expect(cb.toolResults).toHaveLength(2)
    expect(JSON.parse(cb.toolResults[0]!.result)).toMatchObject({
      status: 'error',
      error: { code: 'TOOL_ERROR', message: 'write failed' },
    })
    expect(cb.toolResults[1]!.result).toBe('second result')
    const toolMessages = (agent as any).messages.filter((message: any) => message.role === 'tool')
    expect(toolMessages.map((message: any) => message.tool_call_id)).toEqual(['call_failed', 'call_ok'])
  })
})
