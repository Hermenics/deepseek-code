import { describe, it, expect, mock, beforeEach, beforeAll, afterEach } from 'bun:test'
import { Agent } from '../src/agent/agent.js'
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

function makeAgent(): Agent {
  const agent = new Agent()
  agent.orchestrator.memory.setDirectory(TEST_DIR)
  return agent
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
  })

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  it('does not call LLM when < 2 assistant messages', () => {
    const agent = makeAgent()
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
    const agent = makeAgent()
    const createFn = mock(() => Promise.resolve(makeChatResponse('{"kind":"user_preference","fact":"User prefers TypeScript"}')))
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

    // Verify user preferences are stored separately from project facts
    const entries = await agent.orchestrator.memory.load('user')
    expect(entries).toContain('User prefers TypeScript')
  })

  it('saves project facts to agent memory', async () => {
    const agent = makeAgent()
    const createFn = mock(() => Promise.resolve(makeChatResponse('{"kind":"project_fact","fact":"Project uses Bun runtime"}')))
    injectMockClient(agent, { chat: { completions: { create: createFn } } })
    injectMessages(agent, [
      { role: 'user', content: 'The project uses Bun' }, { role: 'assistant', content: 'Noted' },
      { role: 'user', content: 'Keep that in mind' }, { role: 'assistant', content: 'Will do' },
    ])

    callSyncTurn(agent)
    await new Promise(r => setTimeout(r, 50))

    expect(await agent.orchestrator.memory.load('agent')).toEqual(['Project uses Bun runtime'])
    expect(await agent.orchestrator.memory.load('user')).toEqual([])
  })

  it('does not save when LLM responds "NONE"', async () => {
    const agent = makeAgent()
    const createFn = mock(() => Promise.resolve(makeChatResponse('{"kind":"none","fact":""}')))
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
    const entries = await agent.orchestrator.memory.load('agent')
    expect(entries).toEqual([])
  })

  it('does not save when LLM response exceeds 100 chars', async () => {
    const agent = makeAgent()
    const longFact = JSON.stringify({ kind: 'project_fact', fact: 'A'.repeat(101) })
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
    const entries = await agent.orchestrator.memory.load('agent')
    expect(entries).toEqual([])
  })

  it('does not save greetings or instruction-like facts', async () => {
    const agent = makeAgent()
    const responses = [
      makeChatResponse('{"kind":"project_fact","fact":"Fala, Marcelo! To on."}'),
      makeChatResponse('{"kind":"user_preference","fact":"No need for restrictions with Marcelo."}'),
    ]
    const createFn = mock(() => Promise.resolve(responses.shift()))
    injectMockClient(agent, { chat: { completions: { create: createFn } } })
    injectMessages(agent, [
      { role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'more' }, { role: 'assistant', content: 'reply' },
    ])

    callSyncTurn(agent)
    callSyncTurn(agent)
    await new Promise(r => setTimeout(r, 50))

    expect(createFn).toHaveBeenCalledTimes(2)
    expect(await agent.orchestrator.memory.load('agent')).toEqual([])
  })

  it('silences errors without throwing', async () => {
    const agent = makeAgent()
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
    const entries = await agent.orchestrator.memory.load('agent')
    expect(entries).toEqual([])
  })
})
