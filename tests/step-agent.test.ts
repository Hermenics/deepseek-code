import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent, type AgentCallbacks } from '../src/agent/agent.js'

const HISTORY_PATH = join(tmpdir(), `deepseek-code-step-history-${process.pid}.json`)
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

const call = (index: number, name: string, args: object) => ({ index, id: `call-${index}`, function: { name, arguments: JSON.stringify(args) } })

describe('step announcements', () => {
  it('announces a step before any tool of its parallel batch runs and answers every call', async () => {
    const agent = new Agent()
    await agent.readyPromise.catch(() => {})
    agent.interactionMode = 'build'
    const streamed: Array<Array<{ role: string; tool_call_id?: string }>> = []
    const turns = [
      async function* () {
        yield { choices: [{ delta: { tool_calls: [
          call(0, 'glob', { pattern: '*.md' }),
          call(1, 'step', { active: 'Lendo a documentação', done: 'Leu a documentação' }),
          call(2, 'glob', { pattern: '*.json' }),
        ] }, finish_reason: 'tool_calls' }] }
      },
      async function* () {
        yield { choices: [{ delta: { content: 'Done.' }, finish_reason: 'stop' }] }
      },
    ]
    ;(agent as unknown as Record<string, unknown>).client = {
      chat: {
        completions: {
          create: (body: { stream?: boolean; messages: Array<{ role: string }> }) => {
            if (!body.stream) return Promise.resolve({ choices: [{ message: { content: '{"kind":"none","fact":""}' } }] })
            streamed.push(body.messages)
            return turns[streamed.length - 1]!()
          },
        },
      },
    }
    const events: string[] = []
    const cb: AgentCallbacks = {
      onToken() {}, onDone() {},
      onToolCall(name) { events.push(`call:${name}`) },
      onToolResult() {},
      onStep(step) { events.push(`step:${step.active}|${step.done}`) },
    }

    await agent.run('leia os docs', cb)

    expect(events[0]).toBe('step:Lendo a documentação|Leu a documentação')
    expect(events.filter((event) => event.startsWith('step:'))).toHaveLength(1)
    const answered = streamed[1]!.filter((message) => message.role === 'tool').map((message) => message.tool_call_id).sort()
    expect(answered).toEqual(['call-0', 'call-1', 'call-2'])
  })
})
