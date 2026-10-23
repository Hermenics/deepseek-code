import { describe, it, expect, mock, spyOn, beforeEach, afterEach, beforeAll, afterAll } from 'bun:test'
import { Agent, canonicalResearchUrl, evidenceUrls } from '../src/agent/agent.js'
import type { AgentCallbacks, ToolPermissionResult } from '../src/agent/agent.js'
import * as modelInfo from '../src/agent/modelInfo.js'
import type { Tool } from '../src/tools/types.js'
import type { OrchestratorSession } from '../src/orchestration/OrchestratorSession.js'
import { removeTempDirectory } from './helpers/removeTempDirectory.js'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { ReadFile } from '../src/tools/ReadFile/ReadFile.js'
import { createHash } from 'node:crypto'

const TEST_HISTORY_PATH = join(tmpdir(), `deepseek-code-agent-history-${process.pid}.json`)
const ORIGINAL_HISTORY_PATH = process.env.DEEPSEEK_HISTORY_PATH
if (process.platform === 'win32' && process.env.CI === 'true') process.env.DEEPSEEK_DEBUG_AGENT_INIT = '1'

// Helper: injects a mocked client into Agent via cast (same pattern as reasoning.test.ts)
function injectMockClient(agent: Agent, clientMock: object) {
  ;(agent as unknown as Record<string, unknown>).client = clientMock
}

// Helper: resolves readyPromise without waiting for real asynchronous initialization
function resolveReady(agent: Agent) {
  ;(agent as unknown as Record<string, unknown>).readyPromise = Promise.resolve()
}

// Helper: reads the current system message content (observes the real prompt)
function systemPromptContent(agent: Agent): string {
  return String(agent.getMessages()[0]?.content ?? '')
}

// Helper: creates an async iterable from chunks
async function* makeStream(chunks: object[]) {
  for (const chunk of chunks) {
    yield chunk
  }
}

// Helper: creates an async iterable that throws after several chunks
async function* makeErrorStream(chunks: object[], error: Error) {
  for (const chunk of chunks) {
    yield chunk
  }
  throw error
}

// Agent requires an API key to instantiate the OpenAI client
beforeAll(() => {
  process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-key-for-unit-tests'
  process.env.DEEPSEEK_HISTORY_PATH = TEST_HISTORY_PATH
})

afterAll(async () => {
  if (ORIGINAL_HISTORY_PATH === undefined) delete process.env.DEEPSEEK_HISTORY_PATH
  else process.env.DEEPSEEK_HISTORY_PATH = ORIGINAL_HISTORY_PATH
  await rm(TEST_HISTORY_PATH, { force: true })
})

// Helper: create a no-op callbacks object
function createMockCallbacks(): AgentCallbacks & { tokens: string[]; toolCalls: string[]; done: boolean } {
  const state = { tokens: [] as string[], toolCalls: [] as string[], done: false }
  return {
    ...state,
    onToken(text: string) { state.tokens.push(text) },
    onToolCall(name: string) { state.toolCalls.push(name) },
    onToolResult() {},
    onDone() { state.done = true },
  }
}

describe('Agent class', () => {
  describe('model research evidence', () => {
    it('canonicalizes only valid HTTP(S) evidence URLs', () => {
      expect(canonicalResearchUrl('https://example.com/model#overview')).toBe('https://example.com/model')
      expect(canonicalResearchUrl('file:///tmp/model')).toBeNull()
      expect(canonicalResearchUrl('https://user:pass@example.com/model')).toBeNull()
      expect(evidenceUrls('Docs: https://example.com/model.')).toEqual(new Set(['https://example.com/model']))
    })

    it('accepts scheme-less display URLs from search results', () => {
      expect(evidenceUrls('GPT-6 Sol | GetLLMs getllms.org/models/gpt-6-sol Key Features')).toEqual(new Set(['https://getllms.org/models/gpt-6-sol']))
      expect(canonicalResearchUrl('getllms.org/models/gpt-6-sol')).toBe('https://getllms.org/models/gpt-6-sol')
      expect(evidenceUrls('gpt-5.6 and e.g. Node.js')).toEqual(new Set())
    })

    it('does not prompt for default web-fetch approval during model description research', async () => {
      const projectRoot = await mkdtemp(join(tmpdir(), 'deepseek-agent-modelinfo-'))
      const agent = new Agent({ provider: 'deepseek', apiKey: 'test-key' }, { projectRoot, logFile: null, snapshotFile: null, simulationMode: true })
      const saveCache = spyOn(modelInfo, 'saveCachedDescriptions').mockResolvedValue()
      try {
        await (agent as unknown as { readyPromise: Promise<void> }).readyPromise
        ;(agent as unknown as { settings: { permissions: { allow: string[]; deny: string[] } } }).settings.permissions = { allow: [], deny: [] }
        const toolMap = (agent as unknown as { toolMap: Map<string, Tool> }).toolMap
        const webFetch = toolMap.get('web_fetch')
        if (!webFetch) throw new Error('web_fetch tool is not installed')
        const source = 'https://docs.example.test/unlisted-model-auth-gate-test'
        const executeSearch = mock(async () => `Model documentation: ${source}`)
        toolMap.set('web_fetch', { ...webFetch, execute: executeSearch })

        const createCompletion = mock(async () => ({ choices: [{ message: { content: '{}' } }] }))
        injectMockClient(agent, {
          chat: { completions: { create: createCompletion } },
          models: { list: mock(async () => ({ [Symbol.asyncIterator]: async function* () {} })) },
        })
        const requestPermission = mock(async () => 'deny' as ToolPermissionResult)
        agent.setToolPermissionHandler(requestPermission)

        const descriptions = await agent.generateDescriptions(['unlisted-model-auth-gate-test'])
        expect(descriptions).toEqual({})
        expect(requestPermission).not.toHaveBeenCalled()
        expect(executeSearch).toHaveBeenCalledTimes(1)
        expect(createCompletion).toHaveBeenCalledTimes(1)

        ;(agent as unknown as { settings: { permissions: { allow: string[]; deny: string[] } } }).settings.permissions = { allow: [], deny: ['web_fetch'] }
        expect(await agent.generateDescriptions(['explicitly-denied-model'])).toEqual({})
        expect(executeSearch).toHaveBeenCalledTimes(1)
        expect(createCompletion).toHaveBeenCalledTimes(1)
      } finally {
        saveCache.mockRestore()
        await agent.shutdown()
        await removeTempDirectory(projectRoot)
      }
    })
  })

  describe('constructor', () => {
    it('should create an agent with default config', () => {
      const agent = new Agent()
      expect(agent.model).toBe('deepseek-flash')
      expect(agent.activeAgent).toBeNull()
      expect(agent.provider).toBe('deepseek')
    })

    it('should accept provider config', () => {
      const agent = new Agent({ provider: 'deepseek', apiKey: 'test-key' })
      expect(agent.provider).toBe('deepseek')
    })

    it('keeps prompt refinement opt-in', async () => {
      const agent = new Agent({ provider: 'deepseek', apiKey: 'test-key' })
      await agent.readyPromise
      expect(agent.promptRefinerEnabled).toBe(false)
    })
  })

  describe('task inspection', () => {
    it('shows when a task may have started effects before a replay', async () => {
      const agent = new Agent({ provider: 'deepseek', apiKey: 'test-key' }, { logFile: null, snapshotFile: null })
      await agent.readyPromise.catch(() => {})
      const session = (agent as unknown as { orchestrator: OrchestratorSession }).orchestrator
      const task = session.spawn({ taskId: 'effect-inspection' }, async context => {
        await context.markEffectStarted('write_file')
        return 'done'
      })

      try {
        expect((await task.awaitResult()).status).toBe('done')
        expect(agent.formatTasks()).toContain('possible effects started; reconcile before replay')
        ;(agent as unknown as { refreshProjectContextMessage(): void }).refreshProjectContextMessage()
        expect(agent.getMessages().some(message => String(message.content).includes('"effectMayHaveStarted":true'))).toBe(true)
      } finally {
        await agent.shutdown()
      }
    })
  })

  describe('prompt context and tool payload', () => {
    it('keeps project guidance out of the core system message', async () => {
      const root = await mkdtemp(join(tmpdir(), 'deepseek-agent-context-'))
      await writeFile(join(root, 'AGENTS.md'), 'PROJECT_CONTEXT_SENTINEL', 'utf8')
      const agent = new Agent({ provider: 'deepseek', apiKey: 'test-key' }, { projectRoot: root })

      try {
        await agent.readyPromise
        const messages = agent.getMessages()
        expect(String(messages[0]?.content)).not.toContain('PROJECT_CONTEXT_SENTINEL')
        expect(messages.some((message) => String(message.content).includes('PROJECT_CONTEXT_SENTINEL'))).toBe(true)

        agent.clearHistory()
        expect(agent.getMessages().some((message) => String(message.content).includes('PROJECT_CONTEXT_SENTINEL'))).toBe(true)
      } finally {
        await agent.shutdown()
        await rm(root, { recursive: true, force: true })
      }
    })

    it('sends only mode-available tools with read-only action schemas', async () => {
      const agent = new Agent({ provider: 'deepseek', apiKey: 'test-key' })
      try {
        await agent.readyPromise
        agent.interactionMode = 'plan'
        const tools = (agent as any).getAvailableOpenAITools() as Array<{ function: { name: string; parameters: any } }>
        const names = tools.map((tool) => tool.function.name)
        const git = tools.find((tool) => tool.function.name === 'git')
        const todo = tools.find((tool) => tool.function.name === 'todo')

        expect(names).not.toContain('shell')
        expect(names).not.toContain('write_file')
        expect(git?.function.parameters.properties.action.enum).toEqual(['status', 'diff', 'log'])
        expect(todo?.function.parameters.properties.action.enum).toEqual(['list'])
      } finally {
        await agent.shutdown()
      }
    })

    it('injects the live mode and tool inventory into the API system prompt', async () => {
      const agent = new Agent({ provider: 'deepseek', apiKey: 'test-key' })
      try {
        await agent.readyPromise
        agent.interactionMode = 'build'
        const buildPrompt = String((agent as any).getApiSystemPrompt())
        const buildContract = buildPrompt.slice(buildPrompt.indexOf('<deepseek-runtime-contract>'))

        expect(buildContract).toContain('Current interaction mode: build.')
        expect(buildContract).toContain('"shell"')
        expect(buildContract).toContain('"write_file"')
        expect(buildContract).toContain('live schema')

        agent.interactionMode = 'plan'
        const planPrompt = String((agent as any).getApiSystemPrompt())
        const planContract = planPrompt.slice(planPrompt.indexOf('<deepseek-runtime-contract>'))
        expect(planContract).toContain('Current interaction mode: plan.')
        expect(planContract).toContain('"write_plan"')
        expect(planContract).not.toContain('"shell"')
        expect(planContract).not.toContain('"write_file"')
      } finally {
        await agent.shutdown()
      }
    })

    it('keeps project context available after compaction', async () => {
      const root = await mkdtemp(join(tmpdir(), 'deepseek-agent-compact-'))
      await writeFile(join(root, 'AGENTS.md'), 'COMPACT_CONTEXT_SENTINEL', 'utf8')
      const agent = new Agent({ provider: 'deepseek', apiKey: 'test-key' }, { projectRoot: root })

      try {
        await agent.readyPromise
        const system = agent.getMessages()[0]
        await agent.loadSessionMessages([
          { role: 'system', content: String(system?.content ?? '') },
          { role: 'user', content: 'task to summarize' },
        ])
        injectMockClient(agent, {
          chat: {
            completions: {
              create: async () => ({ choices: [{ message: { content: Array.from({ length: 9 }, (_, index) => `## ${index + 1}. Section\nPreserved context`).join('\n') } }] }),
            },
          },
        })

        await agent.compact()
        const raw = agent.getRawMessages()
        const boundary = raw.findIndex((message) => message.role === '__compact_boundary__')
        expect(String((raw[boundary + 1] as any)?.content)).toContain('COMPACT_CONTEXT_SENTINEL')
      } finally {
        await agent.shutdown()
        await removeTempDirectory(root)
      }
    })
  })

  describe('read-before-edit records', () => {
    it('reconciles saved workspace versions and clears stale grants on resume', async () => {
      const root = await mkdtemp(join(tmpdir(), 'deepseek-agent-resume-'))
      const options = { projectRoot: root, logFile: null, snapshotFile: null }
      const agent = new Agent({ provider: 'deepseek', apiKey: 'test-key' }, options)
      const resumed = new Agent({ provider: 'deepseek', apiKey: 'test-key' }, options)
      try {
        await Promise.all([agent.readyPromise, resumed.readyPromise])
        await writeFile(join(root, 'file.ts'), 'before')
        const original = agent as any
        original.sessionEvidence.add('request', 'user', 'Preserve the library interface')
        await original.reconcileWorkspace(false)
        const saved = agent.getRawMessages()
        await writeFile(join(root, 'file.ts'), 'after')
        const restored = resumed as any
        restored.sessionApprovedTools.add('shell')
        restored.sessionApprovedDirectories.add('/tmp')
        restored.fileReadVersions.set(join(root, 'file.ts'), { exists: true, hash: 'stale' })
        await resumed.loadSessionMessages(saved)
        await resumed.readyPromise
        expect(restored.sessionApprovedTools.size).toBe(0)
        expect(restored.sessionApprovedDirectories.size).toBe(0)
        expect(restored.fileReadVersions.size).toBe(0)
        expect(JSON.stringify(resumed.getMessages())).toContain('Changed since saved state: digest')
        expect(JSON.stringify(resumed.getMessages())).toContain('Preserve the library interface')
        expect(resumed.getMessages().some((message: any) => message.name === 'deepseek_runtime_evidence_v1')).toBe(false)
      } finally {
        await Promise.all([agent.shutdown(), resumed.shutdown()])
        await rm(root, { recursive: true, force: true })
      }
    })

    it('records successful batched reads after a failed path and through a symlink', async () => {
      const root = await mkdtemp(join(tmpdir(), 'deepseek-agent-read-seen-'))
      const agent = new Agent({ provider: 'deepseek', apiKey: 'test-key' }, { projectRoot: root, logFile: null, snapshotFile: null })
      try {
        await agent.readyPromise
        if (process.platform === 'win32') return
        const target = join(root, 'target.txt')
        const alias = join(root, 'alias.txt')
        await writeFile(target, 'source', 'utf8')
        await symlink(target, alias)
        const internals = agent as unknown as {
          executeTool(toolName: string, args: Record<string, unknown>): Promise<string>
          fileReadVersions: Map<string, { exists: boolean; hash?: string }>
        }
        await internals.executeTool('read_file', { paths: ['missing.txt', 'alias.txt'] })
        expect(internals.fileReadVersions.get(join(root, 'missing.txt'))).toEqual({ exists: false, hash: createHash('sha256').update('').digest('hex') })
        expect(internals.fileReadVersions.get(alias)).toEqual({ exists: true, hash: createHash('sha256').update('source').digest('hex') })
      } finally {
        await agent.shutdown()
        await rm(root, { recursive: true, force: true })
      }
    })
  })

  describe('setModel', () => {
    it('should change the model', () => {
      const agent = new Agent()
      agent.setModel('deepseek-reasoner')
      expect(agent.model).toBe('deepseek-reasoner')
    })

    it('should update context limit when changing model', () => {
      const agent = new Agent()
      agent.setModel('deepseek-reasoner')
      expect(agent.contextLimit).toBe(1_000_000)
    })

    it('refreshes the active context limit from discovered model metadata', async () => {
      const agent = new Agent({ provider: 'deepseek', apiKey: 'test-key' })
      resolveReady(agent)
      agent.setModel('active-model')
      injectMockClient(agent, {
        models: {
          list: async function* () {
            yield { id: 'active-model', context_length: '999999' }
            yield { id: 'inactive-model', context_length: 123456 }
          },
        },
      })

      expect(await agent.getAvailableModels()).toEqual(['active-model', 'inactive-model'])
      expect(agent.contextLimit).toBe(999999)
      expect(agent.getModelContextLimit('inactive-model')).toBe(123456)
    })

    it('preserves provider errors when listing available models', async () => {
      const agent = new Agent({ provider: 'deepseek', apiKey: 'test-key' })
      resolveReady(agent)
      const providerError = new Error('Model catalog unavailable')
      injectMockClient(agent, { models: { list: mock(async () => { throw providerError }) } })

      await expect(agent.getAvailableModels()).rejects.toBe(providerError)
    })

    it('should accept arbitrary model string', () => {
      const agent = new Agent()
      agent.setModel('gpt-4-turbo')
      expect(agent.model).toBe('gpt-4-turbo')
    })

    it('should use default context limit for unknown model', () => {
      const agent = new Agent()
      agent.setModel('some-unknown-model-xyz')
      expect(agent.contextLimit).toBe(128_000)
    })

    it('should accept model with slash (provider/model format)', () => {
      const agent = new Agent()
      agent.setModel('google/gemini-2.0-flash-001')
      expect(agent.model).toBe('google/gemini-2.0-flash-001')
    })
  })

  describe('clearHistory', () => {
    it('should reset messages to only system prompt', () => {
      const agent = new Agent()
      agent.clearHistory()
      const messages = agent.getMessages()
      expect(messages.length).toBe(1)
      expect(messages[0].role).toBe('system')
    })
  })

  describe('getFilesModified', () => {
    it('should return empty array initially', () => {
      const agent = new Agent()
      expect(agent.getFilesModified()).toEqual([])
    })
  })

  describe('getSystemPrompt', () => {
    it('should return a safe permission summary, never the prompt', () => {
      const agent = new Agent()
      const summary = agent.getSystemPrompt()
      expect(summary).toContain('Mode:')
      expect(summary).toContain('Mode tools')
      expect(summary).not.toContain('Never do these things')
    })
  })

  describe('getToolNames', () => {
    it('should return array of tool names', () => {
      const agent = new Agent()
      const names = agent.getToolNames()
      expect(names).toBeArray()
      expect(names.length).toBeGreaterThan(0)
      expect(names).toContain('read_file')
      expect(names).toContain('write_file')
      expect(names).toContain('shell')
    })
  })

  describe('getCostSummary', () => {
    it('should return formatted cost string', () => {
      const agent = new Agent()
      const summary = agent.getCostSummary()
      expect(summary).toContain('Model:')
      expect(summary).toContain('Tokens:')
      expect(summary).toContain('Estimated cost:')
    })
  })

  describe('getLastUserMessage', () => {
    it('should return null initially', () => {
      const agent = new Agent()
      expect(agent.getLastUserMessage()).toBeNull()
    })
  })

  describe('setLanguage', () => {
    it('should add language instruction to system prompt', () => {
      const agent = new Agent()
      agent.setLanguage('Portuguese')
      const prompt = systemPromptContent(agent)
      expect(prompt).toContain('PREFERRED LANGUAGE')
      expect(prompt).toContain('Portuguese')
    })

    it('should replace existing language instruction', () => {
      const agent = new Agent()
      agent.setLanguage('English')
      agent.setLanguage('Portuguese')
      const prompt = systemPromptContent(agent)
      expect(prompt).toContain('Portuguese')
      expect(prompt).not.toContain('Always respond in English')
    })
  })

  describe('loadSessionMessages', () => {
    it('should replace current messages', async () => {
      const agent = new Agent()
      const newMessages = [
        { role: 'system' as const, content: 'custom prompt' },
        { role: 'user' as const, content: 'hello' },
      ]
      await agent.loadSessionMessages(newMessages)
      expect(agent.getMessages()).toEqual(expect.arrayContaining(newMessages))
      expect(agent.getMessages().some(message => typeof message.content === 'string' && message.content.includes('Resumed conversation.'))).toBe(true)
    })
  })

  describe('applyAgentConfig', () => {
    it('should set active agent name', async () => {
      const agent = new Agent()
      await agent.applyAgentConfig({
        name: 'test-agent',
        systemPrompt: 'You are a test agent.',
      })
      expect(agent.activeAgent).toBe('test-agent')
    })

    it('should set model from config', async () => {
      const agent = new Agent()
      await agent.applyAgentConfig({
        name: 'test-agent',
        model: 'deepseek-reasoner',
        systemPrompt: 'Test prompt.',
      })
      expect(agent.model).toBe('deepseek-reasoner')
    })

    it('should clear history when applying config', async () => {
      const agent = new Agent()
      await agent.applyAgentConfig({
        name: 'test-agent',
        systemPrompt: 'New system prompt.',
      })
      const messages = agent.getMessages()
      expect(messages.length).toBe(1)
      expect(messages[0].content).toContain('You are DeepSeek Code')
      expect(messages[0].content).toContain('New system prompt.')
      expect(messages[0].content).toContain('Subordinate agent specialization')
      expect(messages[0].content).not.toBe('New system prompt.')
    })
  })

  describe('resetAgent', () => {
    it('should reset to defaults', async () => {
      const agent = new Agent()
      await agent.applyAgentConfig({
        name: 'test-agent',
        model: 'deepseek-reasoner',
        systemPrompt: 'Custom.',
      })
      agent.resetAgent()
      expect(agent.activeAgent).toBeNull()
      expect(agent.model).toBe('deepseek-flash')
    })
  })

  describe('undo', () => {
    it('should return "Nothing to undo." when stack is empty', async () => {
      const agent = new Agent()
      const result = await agent.undo()
      expect(result).toBe('Nothing to undo.')
    })
  })

  describe('setConfirmHandler', () => {
    it('should accept null handler', () => {
      const agent = new Agent()
      expect(() => agent.setConfirmHandler(null)).not.toThrow()
    })

    it('should accept function handler', () => {
      const agent = new Agent()
      const handler = async () => true
      expect(() => agent.setConfirmHandler(handler)).not.toThrow()
    })
  })

  describe('setToolPermissionHandler', () => {
    it('should accept null handler', () => {
      const agent = new Agent()
      expect(() => agent.setToolPermissionHandler(null)).not.toThrow()
    })

    it('should accept function handler', () => {
      const agent = new Agent()
      const handler = async (): Promise<ToolPermissionResult> => 'once'
      expect(() => agent.setToolPermissionHandler(handler)).not.toThrow()
    })
  })

  describe('askBtw', () => {
    it('uses a separate tool-free request without changing the main history', async () => {
      const agent = new Agent()
      await agent.readyPromise
      await agent.loadSessionMessages([
        { role: 'system', content: 'system' },
        { role: 'user', content: 'main task' },
      ])
      const create = mock(async (_params: unknown) => ({
        choices: [{ message: { content: 'side answer' } }],
        usage: { total_tokens: 3, prompt_tokens: 2, completion_tokens: 1 },
      }))
      injectMockClient(agent, { chat: { completions: { create } } })

      await agent.readyPromise
      const historyBefore = structuredClone(agent.getMessages())
      await expect(agent.askBtw('what is the status?')).resolves.toBe('side answer')
      expect(create).toHaveBeenCalledTimes(1)
      expect(agent.getMessages()).toEqual(historyBefore)
      const request = create.mock.calls[0]?.[0] as any
      expect(request).toMatchObject({ stream: false })
      expect(request).not.toHaveProperty('tools')
      expect(request).not.toHaveProperty('tool_choice')
    })

    it('omits an unfinished tool exchange from the side-question snapshot', async () => {
      const agent = new Agent()
      await agent.readyPromise
      await agent.loadSessionMessages([
        { role: 'system', content: 'system' },
        { role: 'user', content: 'main task' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
      ] as any)
      const create = mock(async (_params: unknown) => ({ choices: [{ message: { content: 'side answer' } }] }))
      injectMockClient(agent, { chat: { completions: { create } } })

      await agent.askBtw('what happened?')
      const request = create.mock.calls[0]?.[0] as any
      expect(request.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ content: 'main task' }),
      ]))
      expect(request.messages).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ tool_calls: expect.anything() }),
      ]))
    })

    it('stops retries when the side-question caller aborts', async () => {
      const agent = new Agent()
      await agent.readyPromise
      const caller = new AbortController()
      let requestSignal: AbortSignal | undefined
      let started!: () => void
      const createStarted = new Promise<void>((resolve) => { started = resolve })
      const create = mock(async (_params: unknown, options: { signal: AbortSignal }) => {
        requestSignal = options.signal
        started()
        return await new Promise((_, reject) => requestSignal!.addEventListener('abort', () => {
          reject(Object.assign(new Error('cancelled'), { status: 503 }))
        }, { once: true }))
      })
      injectMockClient(agent, { chat: { completions: { create } } })

      const pending = agent.askBtw('stop this', caller.signal)
      await createStarted
      expect(requestSignal).not.toBe(caller.signal)
      caller.abort()

      await expect(pending).rejects.toThrow('cancelled')
      expect(create).toHaveBeenCalledTimes(1)
    })
  })

  describe('getStats', () => {
    it('should return a string with session statistics', () => {
      const agent = new Agent()
      const stats = agent.getStats()
      expect(typeof stats).toBe('string')
      expect(stats).toContain('Duration')
      expect(stats).toContain('Model')
      expect(stats).toContain('Tokens')
      expect(stats).toContain('Tool calls')
      expect(stats).toContain('Cost')
    })

    it('should include provider info', () => {
      const agent = new Agent({ provider: 'deepseek', apiKey: 'test' })
      const stats = agent.getStats()
      expect(stats).toContain('deepseek')
    })
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// Tests for Agent.run() error propagation
// Context: API errors (401, 503, broken streams) must propagate by rejecting
// the promise returned by run(). The reported bug is that the UI does not catch
// these errors; this confirms that Agent already propagates them correctly.
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent error propagation', () => {
  // Callbacks with tracked mocks verify that onDone is NOT called on errors.
  function makeTrackedCallbacks() {
    return {
      onToken: mock((_text: string) => {}),
      onToolCall: mock((_name: string) => {}),
      onToolResult: mock((_name: string, _result: string) => {}),
      onDone: mock(() => {}),
    }
  }

  it('continues past 100 tool iterations until the model finishes', async () => {
    const agent = new Agent({ provider: 'vertex', gcpProject: 'test', gcpLocation: 'global', gcpCredentials: '/tmp/test-service-account.json' })
    resolveReady(agent)
    // Vertex streams now — the mock returns a fresh async-iterable stream per call
    let calls = 0
    const create = mock(async () => ({
      [Symbol.asyncIterator]: async function* () {
        if (++calls > 100) {
          yield { choices: [{ delta: { content: 'Done' } }] }
          return
        }
        yield {
          choices: [{ delta: { tool_calls: [{ index: 0, id: 'loop', function: { name: 'unknown_tool', arguments: '{}' } }] } }],
          usage: { total_tokens: 1, prompt_tokens: 1, completion_tokens: 0 },
        }
      },
    }))
    injectMockClient(agent, { chat: { completions: { create } } })
    const cb = makeTrackedCallbacks()
    await agent.run('loop', cb)
    expect(cb.onDone).toHaveBeenCalledTimes(1)
    expect(create.mock.calls.length).toBeGreaterThan(100)
    expect(cb.onToken).toHaveBeenCalledWith('Done')
  })

  describe('run(): API errors must propagate', () => {
    it('should reject with API error and NOT call onDone when create throws 401', async () => {
      // Arrange
      const agent = new Agent()
      resolveReady(agent)

      const apiError = new Error('401 Unauthorized')
      ;(apiError as unknown as Record<string, unknown>).status = 401

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock(() => { throw apiError }),
          },
        },
        models: {
          list: mock(async () => ({ [Symbol.asyncIterator]: async function* () {} })),
        },
      })

      const cb = makeTrackedCallbacks()

      // Act + Assert
      await expect(agent.run('hello', cb)).rejects.toThrow('401 Unauthorized')
      expect(cb.onDone).not.toHaveBeenCalled()
    })

    it('should reject with API error and NOT call onDone when create throws generic auth error', async () => {
      // Arrange
      const agent = new Agent()
      resolveReady(agent)

      const authError = new Error('Authentication failed: invalid API key')

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock(() => { throw authError }),
          },
        },
        models: {
          list: mock(async () => ({ [Symbol.asyncIterator]: async function* () {} })),
        },
      })

      const cb = makeTrackedCallbacks()

      // Act + Assert
      await expect(agent.run('hello', cb)).rejects.toThrow('Authentication failed')
      expect(cb.onDone).not.toHaveBeenCalled()
    })
  })

  describe('run(): network errors must propagate after retries are exhausted', () => {
    it('should reject after retries are exhausted when create throws 503', async () => {
      // Arrange
      const agent = new Agent()
      resolveReady(agent)

      const networkError = new Error('Service Unavailable')
      ;(networkError as unknown as Record<string, unknown>).status = 503

      // withRetry tries four times (attempts 0–3) for status 503; the mock always fails.
      const createMock = mock(() => { throw networkError })

      injectMockClient(agent, {
        chat: {
          completions: {
            // Replace retry delays so the test does not run slowly.
            create: createMock,
          },
        },
        models: {
          list: mock(async () => ({ [Symbol.asyncIterator]: async function* () {} })),
        },
      })

      // Set withRetry delays to zero so the test runs quickly.
      ;(agent as unknown as Record<string, unknown>).withRetry = async (fn: () => Promise<unknown>) => {
        const delays = [0, 0, 0]
        for (let attempt = 0; attempt <= delays.length; attempt++) {
          try {
            return await fn()
          } catch (e: unknown) {
            const err = e as { status?: number }
            if ((err.status === 503) && attempt < delays.length) continue
            throw e
          }
        }
        throw new Error('unreachable')
      }

      const cb = makeTrackedCallbacks()

      // Act + Assert — must reject after exhausting retries.
      await expect(agent.run('hello', cb)).rejects.toThrow('Service Unavailable')
      expect(cb.onDone).not.toHaveBeenCalled()
      // Confirm that all four attempts ran (attempts 0, 1, 2, and 3).
      expect(createMock).toHaveBeenCalledTimes(4)
    }, 10_000)
  })

  describe('run(): errors during streaming must propagate', () => {
    it('should reject when stream throws mid-iteration', async () => {
      // Arrange
      const agent = new Agent()
      resolveReady(agent)

      const streamError = new Error('Stream connection reset')

      // The stream emits one valid chunk and then throws.
      const brokenStream = makeErrorStream(
        [
          { choices: [{ delta: { content: 'Hello' } }] },
        ],
        streamError,
      )

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock(() => brokenStream),
          },
        },
        models: {
          list: mock(async () => ({ [Symbol.asyncIterator]: async function* () {} })),
        },
      })

      const cb = makeTrackedCallbacks()

      // Act + Assert
      await expect(agent.run('hello', cb)).rejects.toThrow('Stream connection reset')
      expect(cb.onDone).not.toHaveBeenCalled()
    })

    it('should reject when stream throws immediately without any chunks', async () => {
      // Arrange
      const agent = new Agent()
      resolveReady(agent)

      const streamError = new Error('Connection refused')

      const emptyBrokenStream = makeErrorStream([], streamError)

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock(() => emptyBrokenStream),
          },
        },
        models: {
          list: mock(async () => ({ [Symbol.asyncIterator]: async function* () {} })),
        },
      })

      const cb = makeTrackedCallbacks()

      // Act + Assert
      await expect(agent.run('hello', cb)).rejects.toThrow('Connection refused')
      expect(cb.onDone).not.toHaveBeenCalled()
    })
  })
})
