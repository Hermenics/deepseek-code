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
}

describe('getCostReport', () => {
  it('adds the account balance and how much it moved since the session started', async () => {
    const agent = new Agent({ provider: 'deepseek', apiKey: 'sk-test' })
    await agent.readyPromise.catch(() => {})
    const internals = agent as unknown as BalanceInternals
    internals.sessionStartBalance = Promise.resolve({ currency: 'USD', total: 4.76 })
    internals.fetchBalance = async () => ({ currency: 'USD', total: 4.74 })

    const report = await agent.getCostReport()

    expect(report).toContain('Estimated cost:')
    expect(report).toContain('Account balance: $4.74')
    expect(report).toContain('Balance change this session: -$0.02')
  })

  it('shows only the estimate when the provider has no balance endpoint', async () => {
    const agent = new Agent({ provider: 'vertex', gcpProject: 'test', gcpLocation: 'global', gcpCredentials: '/tmp/test-service-account.json' })
    await agent.readyPromise.catch(() => {})

    const report = await agent.getCostReport()

    expect(report).toContain('Estimated cost:')
    expect(report).not.toContain('Account balance')
  })
})

describe('side-request usage', () => {
  it('counts compaction tokens in the session cost', async () => {
    const agent = new Agent({ provider: 'deepseek', apiKey: 'sk-test' })
    await agent.readyPromise.catch(() => {})
    const internals = agent as unknown as { messages: object[]; client: object }
    internals.messages.push({ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' })
    internals.client = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: 'summary' } }],
            usage: { total_tokens: 1_100_000, prompt_tokens: 1_000_000, completion_tokens: 100_000, prompt_cache_hit_tokens: 0 },
          }),
        },
      },
    }

    await agent.compact()

    expect(agent.getSessionStats().tokenCount).toBe(1_100_000)
    expect(agent.getSessionStats().costUsd).toBeGreaterThan(0)
  })
})
