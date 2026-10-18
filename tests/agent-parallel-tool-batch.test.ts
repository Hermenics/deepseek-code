import { expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent, type AgentCallbacks } from '../src/agent/agent.js'

function stream(chunks: object[]): AsyncIterable<object> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

it('caps concurrent execution of a parallel-safe tool batch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-bounded-tool-batch-'))
  const agent = new Agent({ provider: 'local', localModel: 'fixture' }, { projectRoot: root, logFile: null, snapshotFile: null })
  const internal = agent as any
  let requestCount = 0
  let active = 0
  let peak = 0
  const executed: string[] = []
  const callbacks: AgentCallbacks = {
    onToken() {},
    onToolCall() {},
    onToolResult() {},
    onDone() {},
  }

  try {
    await agent.readyPromise
    agent.interactionMode = 'auto'
    internal.runPostToolBatchHooks = async () => {}
    internal.openStream = async () => {
      requestCount++
      if (requestCount > 1) return stream([{ choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] }])
      return stream([{
        choices: [{
          delta: { tool_calls: Array.from({ length: 8 }, (_, index) => ({
            index,
            id: `parallel-${index}`,
            function: { name: 'glob', arguments: JSON.stringify({ pattern: `item-${index}` }) },
          })) },
          finish_reason: 'tool_calls',
        }],
      }])
    }
    internal.executeParsedCall = async (call: { tc: { id: string } }) => {
      active++
      peak = Math.max(peak, active)
      try {
        await new Promise(resolve => setTimeout(resolve, 10))
        executed.push(call.tc.id)
        return { tc: call.tc, result: 'done' }
      } finally {
        active--
      }
    }

    await agent.run('Read a few independent paths.', callbacks)

    expect(peak).toBeLessThanOrEqual(4)
    expect(executed).toHaveLength(8)
    expect(executed).toEqual(Array.from({ length: 8 }, (_, index) => `parallel-${index}`))
  } finally {
    await agent.shutdown()
    await rm(root, { recursive: true, force: true })
  }
}, 15_000)
