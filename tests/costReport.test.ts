import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent } from '../src/agent/agent.js'

const HISTORY_PATH = join(tmpdir(), `deepseek-code-cost-report-${process.pid}.json`)
const ORIGINAL_HISTORY_PATH = process.env.DEEPSEEK_HISTORY_PATH

beforeAll(() => {
  process.env.DEEPSEEK_HISTORY_PATH = HISTORY_PATH
})

afterAll(async () => {
  if (ORIGINAL_HISTORY_PATH === undefined) delete process.env.DEEPSEEK_HISTORY_PATH
  else process.env.DEEPSEEK_HISTORY_PATH = ORIGINAL_HISTORY_PATH
  await rm(HISTORY_PATH, { force: true })
})

type BalanceInternals = {
  sessionStartBalance: Promise<unknown> | null
  fetchBalance: () => Promise<unknown>
  recordUsage: (promptTokens?: number, completionTokens?: number, cachedTokens?: number) => void
}

describe('getCostReport', () => {
  it('updates price availability when the model or provider changes', async () => {
    const agent = new Agent({ provider: 'deepseek', apiKey: 'sk-test', baseURL: 'https://api.deepseek.com' })
    await agent.readyPromise.catch(() => {})
    expect(agent.getSessionStats().costAvailable).toBe(true)
    agent.setModel('unknown-model')
    expect(agent.getSessionStats().costAvailable).toBe(false)
    agent.setModel('deepseek-flash')
    expect(agent.getSessionStats().costAvailable).toBe(true)
    agent.setProviderConfig({ provider: 'deepseek', apiKey: 'sk-test', baseURL: 'http://127.0.0.1:8001/v1' })
    expect(agent.getSessionStats().costAvailable).toBe(false)
    agent.setProviderConfig({ provider: 'vertex', gcpProject: 'test', gcpLocation: 'global', gcpCredentials: '/tmp/test-service-account.json' })
    expect(agent.getSessionStats().costAvailable).toBe(false)
  })

  it('adds the account balance and how much it moved since the session started', async () => {
    const agent = new Agent({ provider: 'deepseek', apiKey: 'sk-test', baseURL: 'https://api.deepseek.com' })
    await agent.readyPromise.catch(() => {})
    const internals = agent as unknown as BalanceInternals
    internals.sessionStartBalance = Promise.resolve({ currency: 'USD', total: 4.76 })
    internals.fetchBalance = async () => ({ currency: 'USD', total: 4.74 })

    const report = await agent.getCostReport()

    expect(report).toContain('Estimated cost:')
    expect(report).toContain('Account balance: $4.74')
    expect(report).toContain('Balance change this session: -$0.02')
  })

  it('does not apply DeepSeek pricing to usage billed by a different provider', async () => {
    const agent = new Agent({ provider: 'vertex', gcpProject: 'test', gcpLocation: 'global', gcpCredentials: '/tmp/test-service-account.json' })
    await agent.readyPromise.catch(() => {})
    ;(agent as unknown as BalanceInternals).recordUsage(1_000_000, 100_000, 0)

    const report = await agent.getCostReport()

    expect(report).toContain('Estimated cost: unavailable')
    expect(agent.getSessionStats()).toMatchObject({ costUsd: 0, costAvailable: false })
    expect(report).not.toContain('Account balance')
  })

  it('marks incomplete usage from a priced provider as unavailable', async () => {
    const agent = new Agent({ provider: 'deepseek', apiKey: 'sk-test', baseURL: 'https://api.deepseek.com' })
    await agent.readyPromise.catch(() => {})
    ;(agent as unknown as BalanceInternals).recordUsage(1_000_000, undefined, 0)

    expect(await agent.getCostReport()).toContain('Estimated cost: unavailable')
    expect(agent.getSessionStats().costAvailable).toBe(false)
  })
})

describe('side-request usage', () => {
  it('counts compaction tokens in the session cost', async () => {
    const agent = new Agent({ provider: 'deepseek', apiKey: 'sk-test', baseURL: 'https://api.deepseek.com' })
    await agent.readyPromise.catch(() => {})
    const internals = agent as unknown as { messages: object[]; client: object }
    internals.messages.push({ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' })
    internals.client = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: Array.from({ length: 9 }, (_, index) => `## ${index + 1}. Section\nRetained context`).join('\n') } }],
            usage: { total_tokens: 1_100_000, prompt_tokens: 1_000_000, completion_tokens: 100_000, prompt_cache_hit_tokens: 0 },
          }),
        },
      },
    }

    await agent.compact()

    expect(agent.getSessionStats().tokenCount).toBe(1_100_000)
    expect(agent.getSessionStats().costUsd).toBeGreaterThan(0)
    expect(agent.getSessionStats().costAvailable).toBe(true)
  })
})
