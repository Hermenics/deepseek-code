import { describe, it, expect, mock, beforeEach, beforeAll, afterEach } from 'bun:test'
import { Agent } from '../src/agent/agent.js'
import { setMemoryDir } from '../src/agent/memory.js'
import { join } from 'path'
import { tmpdir } from 'os'
import { rm } from 'fs/promises'

const TEST_DIR = join(tmpdir(), `deepseek-sync-turn-test-${process.pid}-${Date.now()}`)

beforeAll(() => {
  process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-key-for-unit-tests'
})

function injectMockClient(agent: Agent, clientMock: object) {
  ;(agent as unknown as Record<string, unknown>).client = clientMock
}

function injectMessages(agent: Agent, messages: object[]) {
  ;(agent as unknown as Record<string, unknown>).messages = messages
}

function callSyncTurn(agent: Agent) {
  ;(agent as any).syncTurn()
}

function makeChatResponse(content: string) {
  return { choices: [{ message: { content } }] }
}

describe('syncTurn', () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
    setMemoryDir(TEST_DIR)
  })

  afterEach(async () => {
    setMemoryDir(null)
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  it('does not call LLM when < 2 assistant messages', () => {
    const agent = new Agent()
    const createFn = mock(() => Promise.resolve(makeChatResponse('NONE')))
    injectMockClient(agent, { chat: { completions: { create: createFn } } })
    injectMessages(agent, [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ])

    callSyncTurn(agent)
    expect(createFn).not.toHaveBeenCalled()
  })

  it('extracts fact and saves via addEntry on normal turn', async () => {
    const agent = new Agent()
    const createFn = mock(() => Promise.resolve(makeChatResponse('User prefers TypeScript')))
    injectMockClient(agent, { chat: { completions: { create: createFn } } })
    injectMessages(agent, [
      { role: 'user', content: 'I always use TypeScript' },
      { role: 'assistant', content: 'Got it!' },
      { role: 'user', content: 'And Bun as runtime' },
      { role: 'assistant', content: 'Nice choice' },
    ])

    callSyncTurn(agent)

    // Wait for the fire-and-forget promise to resolve
    await new Promise(r => setTimeout(r, 50))

    expect(createFn).toHaveBeenCalledTimes(1)

    // Verify fact was written to memory
    const { loadMemory } = await import('../src/agent/memory.js')
    const entries = await loadMemory('agent')
    expect(entries).toContain('User prefers TypeScript')
  })

  it('does not save when LLM responds "NONE"', async () => {
    const agent = new Agent()
    const createFn = mock(() => Promise.resolve(makeChatResponse('NONE')))
    injectMockClient(agent, { chat: { completions: { create: createFn } } })
    injectMessages(agent, [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'bye' },
      { role: 'assistant', content: 'see ya' },
    ])

    callSyncTurn(agent)
    await new Promise(r => setTimeout(r, 50))

    expect(createFn).toHaveBeenCalledTimes(1)
    const { loadMemory } = await import('../src/agent/memory.js')
    const entries = await loadMemory('agent')
    expect(entries).toEqual([])
  })

  it('does not save when LLM response exceeds 100 chars', async () => {
    const agent = new Agent()
    const longFact = 'A'.repeat(101)
    const createFn = mock(() => Promise.resolve(makeChatResponse(longFact)))
    injectMockClient(agent, { chat: { completions: { create: createFn } } })
    injectMessages(agent, [
      { role: 'user', content: 'some context' },
      { role: 'assistant', content: 'reply 1' },
      { role: 'user', content: 'more context' },
      { role: 'assistant', content: 'reply 2' },
    ])

    callSyncTurn(agent)
    await new Promise(r => setTimeout(r, 50))

    expect(createFn).toHaveBeenCalledTimes(1)
    const { loadMemory } = await import('../src/agent/memory.js')
    const entries = await loadMemory('agent')
    expect(entries).toEqual([])
  })

  it('silences errors without throwing', async () => {
    const agent = new Agent()
    const createFn = mock(() => Promise.reject(new Error('Network failure')))
    injectMockClient(agent, { chat: { completions: { create: createFn } } })
    injectMessages(agent, [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'bye' },
      { role: 'assistant', content: 'cya' },
    ])

    // Should not throw
    expect(() => callSyncTurn(agent)).not.toThrow()
    await new Promise(r => setTimeout(r, 50))

    // No crash, no entry
    const { loadMemory } = await import('../src/agent/memory.js')
    const entries = await loadMemory('agent')
    expect(entries).toEqual([])
  })
})
