import { afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent } from '../src/agent/agent.js'
import type { AgentCallbacks } from '../src/agent/agent.js'

async function* stream(chunks: object[]) {
  for (const chunk of chunks) yield chunk
}

function callbacks(): AgentCallbacks {
  return {
    onToken() {},
    onToolCall() {},
    onToolResult() {},
    onDone() {},
  }
}

describe('primary Agent response usage normalization', () => {
  let root: string | undefined
  let agent: Agent | undefined
  let originalNoStream: string | undefined

  afterEach(async () => {
    await agent?.shutdown()
    if (root) await rm(root, { recursive: true, force: true })
    if (originalNoStream === undefined) delete process.env.DEEPSEEK_NO_STREAM
    else process.env.DEEPSEEK_NO_STREAM = originalNoStream
    agent = undefined
    root = undefined
    originalNoStream = undefined
  })

  async function createAgent(useStreaming: boolean): Promise<Agent> {
    originalNoStream = process.env.DEEPSEEK_NO_STREAM
    if (useStreaming) delete process.env.DEEPSEEK_NO_STREAM
    else process.env.DEEPSEEK_NO_STREAM = '1'
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-usage-'))
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
    })
    await agent.readyPromise
    return agent
  }

  it('derives streamed totals and reads cached prompt tokens from prompt details', async () => {
    const primaryAgent = await createAgent(true)
    ;(primaryAgent as any).client = {
      chat: {
        completions: {
          create: mock(() => stream([
            { choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] },
            { choices: [], usage: { prompt_tokens: 5, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 2 } } },
          ])),
        },
      },
    }

    await primaryAgent.run('Report usage.', callbacks())

    expect(primaryAgent.getSessionStats()).toMatchObject({
      tokenCount: 8,
      promptTokens: 5,
      completionTokens: 3,
      cachedTokens: 2,
      contextUsage: 5,
    })
    expect(Number.isFinite(primaryAgent.getSessionStats().tokenCount)).toBe(true)
  })

  it('derives non-streamed totals and prefers the direct cache-hit count', async () => {
    const primaryAgent = await createAgent(false)
    ;(primaryAgent as any).client = {
      chat: {
        completions: {
          create: mock(async () => ({
            choices: [{ finish_reason: 'stop', message: { content: 'done' } }],
            usage: { prompt_tokens: 4, completion_tokens: 6, prompt_cache_hit_tokens: 1, prompt_tokens_details: { cached_tokens: 3 } },
          })),
        },
      },
    }

    await primaryAgent.run('Report usage.', callbacks())

    expect(primaryAgent.getSessionStats()).toMatchObject({
      tokenCount: 10,
      promptTokens: 4,
      completionTokens: 6,
      cachedTokens: 1,
      contextUsage: 4,
    })
    expect(Number.isFinite(primaryAgent.getSessionStats().tokenCount)).toBe(true)
  })
})
