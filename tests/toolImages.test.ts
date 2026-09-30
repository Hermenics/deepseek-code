import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent, type AgentCallbacks } from '../src/agent/agent.js'
import { supportsVision } from '../src/agent/cost.js'
import { formatMcpToolResult } from '../src/agent/mcp.js'
import type { PromptImage } from '../src/types/input.js'

const HISTORY = join(tmpdir(), `deepseek-code-tool-images-${process.pid}.json`)
const ORIGINAL_HISTORY = process.env.DEEPSEEK_HISTORY_PATH
beforeAll(() => {
  process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-key-for-unit-tests'
  process.env.DEEPSEEK_HISTORY_PATH = HISTORY
})
afterAll(async () => {
  if (ORIGINAL_HISTORY === undefined) delete process.env.DEEPSEEK_HISTORY_PATH
  else process.env.DEEPSEEK_HISTORY_PATH = ORIGINAL_HISTORY
  await rm(HISTORY, { force: true })
})

const PNG: PromptImage = { mediaType: 'image/png', data: 'iVBORw0KGgo=' }

describe('supportsVision', () => {
  it('prefers the explicit setting and otherwise trusts only the DeepSeek catalog on the DeepSeek provider', () => {
    expect(supportsVision({ provider: 'deepseek' }, 'deepseek-flash')).toBe(true)
    expect(supportsVision({ provider: 'deepseek' }, 'deepseek-v4-pro')).toBe(false)
    expect(supportsVision({ provider: 'local' }, 'deepseek-chat')).toBe(false)
    expect(supportsVision({ provider: 'deepseek' }, 'gpt-5.6-luna')).toBe(false)
    expect(supportsVision({ provider: 'deepseek', vision: true }, 'gpt-5.6-luna')).toBe(true)
    expect(supportsVision({ provider: 'deepseek', vision: false }, 'deepseek-flash')).toBe(false)
  })
})

describe('formatMcpToolResult images', () => {
  it('sends image blocks to attachImage instead of dumping base64 into the text', () => {
    const attached: Array<{ image: PromptImage; label: string }> = []
    const text = formatMcpToolResult({ content: [{ type: 'text', text: 'shot taken' }, { type: 'image', mimeType: 'image/png', data: 'AAAA' }] }, (image, label) => attached.push({ image, label }), 'take_screenshot')
    expect(text).toBe('shot taken\n[1 image attached for the model]')
    expect(attached).toEqual([{ image: { mediaType: 'image/png', data: 'AAAA' }, label: 'image returned by take_screenshot' }])
  })

  it('never puts base64 in the text when the model cannot see images', () => {
    const text = formatMcpToolResult({ content: [{ type: 'image', mimeType: 'image/png', data: 'AAAA'.repeat(1000) }] })
    expect(text).toBe('[1 image omitted: the current model does not accept images]')
  })
})

describe('transient tool images', () => {
  async function runWithImages(provider: { provider: 'deepseek'; model: string }) {
    const agent = new Agent({ ...provider, apiKey: 'test-key' })
    await agent.readyPromise.catch(() => {})
    ;(agent as any).settings = { risk: { enabled: false }, permissions: { autoApproveLowRisk: true } }
    let offered: unknown
    ;(agent as any).toolMap.set('read_file', {
      name: 'read_file', description: 'mock', parameters: { type: 'object', properties: { path: { type: 'string' } } },
      async execute(_args: unknown, context: any) {
        offered = context?.attachImage
        context?.attachImage?.({ mediaType: 'image/png', data: 'first' }, 'first image')
        context?.attachImage?.(PNG, 'screenshot of http://localhost:3000')
        return 'captured'
      },
    })
    const requests: any[][] = []
    ;(agent as any).client = { chat: { completions: { create: (body: { stream?: boolean; messages: any[] }) => {
      if (!body.stream) return Promise.resolve({ choices: [{ message: { content: '{"kind":"none","fact":""}' } }] })
      requests.push(body.messages)
      return (async function* () {
        yield requests.length === 1
          ? { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_file', arguments: '{"path":"README.md"}' } }] } }] }
          : { choices: [{ delta: { content: 'blue' } }] }
      })()
    } } } }
    const cb: AgentCallbacks = { onToken() {}, onToolCall() {}, onToolResult() {}, onDone() {} }
    await agent.run('what color?', cb)
    return { agent, requests, offered }
  }

  it('sends only the latest image, once, labeled as untrusted, and keeps it out of history', async () => {
    const { agent, requests } = await runWithImages({ provider: 'deepseek', model: 'deepseek-flash' })
    expect(requests).toHaveLength(2)
    const last = requests[1]!.at(-1)
    expect(last.role).toBe('user')
    expect(last.content.filter((part: any) => part.type === 'image_url')).toHaveLength(1)
    expect(last.content[0].text).toContain('Untrusted tool attachment')
    expect(last.content[1].image_url.url).toBe(`data:image/png;base64,${PNG.data}`)
    expect(JSON.stringify((agent as any).messages)).not.toContain('image_url')
  })

  it('offers no attachImage when the model does not accept images', async () => {
    const { requests, offered } = await runWithImages({ provider: 'deepseek', model: 'deepseek-v4-pro' })
    expect(offered).toBeUndefined()
    expect(JSON.stringify(requests[1])).not.toContain('image_url')
  })
})
