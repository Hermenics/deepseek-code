import { readFileSync } from 'node:fs'
import { DEMO_PROMPT, UPDATED_SOURCE, UPDATED_TESTS } from './scenario.js'

type ChatMessage = { role?: string; content?: unknown; tool_call_id?: string }
type ChatRequest = { model?: string; stream?: boolean; messages?: ChatMessage[] }

const TOOL_CALLS = [
  { name: 'read_file', args: { path: 'src/signup.js' } },
  { name: 'write_file', args: { path: 'src/signup.js', content: UPDATED_SOURCE } },
  { name: 'read_file', args: { path: 'tests/signup.test.js' } },
  { name: 'write_file', args: { path: 'tests/signup.test.js', content: UPDATED_TESTS } },
  { name: 'shell', args: { command: 'bun test' } },
] as const

export interface MockProviderState {
  requests: number
  finished: boolean
  failure?: string
}

function completionChunk(delta: Record<string, unknown>, finishReason: string | null = null) {
  return {
    id: 'demo-completion',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'deepseek-flash',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  }
}

function stream(chunks: Array<Record<string, unknown>>): Response {
  const frames = chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`)
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const frame of frames) {
        controller.enqueue(new TextEncoder().encode(frame))
        await Bun.sleep(90)
      }
      controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
  return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } })
}

function toolResponse(index: number): Response {
  const call = TOOL_CALLS[index]!
  const id = `demo-tool-${index + 1}`
  return stream([
    completionChunk({ role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] }),
    completionChunk({}, 'tool_calls'),
  ])
}

function lastToolResult(messages: ChatMessage[]): string {
  const message = [...messages].reverse().find(item => item.role === 'tool')
  return typeof message?.content === 'string' ? message.content : ''
}

function assertStage(index: number, request: ChatRequest, workspace: string): void {
  const messages = request.messages ?? []
  if (index === 0 && !messages.some(message =>
    message.role === 'user' && typeof message.content === 'string' && message.content.includes(DEMO_PROMPT),
  )) {
    throw new Error('The typed demo prompt did not reach the local model fixture unchanged.')
  }
  if (index === 1 && !lastToolResult(messages).includes('canSubmitSignup')) throw new Error('The CLI did not return the signup source read to the model.')
  if (index === 2 && readFileSync(`${workspace}/src/signup.js`, 'utf8').trim() !== UPDATED_SOURCE.trim()) throw new Error('The source write tool did not apply the expected validation.')
  if (index === 3 && (!lastToolResult(messages).includes('allows a non-empty signup email') || readFileSync(`${workspace}/src/signup.js`, 'utf8').trim() !== UPDATED_SOURCE.trim())) {
    throw new Error('The CLI did not read the existing signup tests before editing them.')
  }
  if (index === 4) {
    const actualTests = readFileSync(`${workspace}/tests/signup.test.js`, 'utf8')
    if (actualTests.trim() !== UPDATED_TESTS.trim()) {
      throw new Error(`The test write tool produced unexpected content; result=${lastToolResult(messages)}; actual=${JSON.stringify(actualTests)}`)
    }
  }
  if (index === 5) {
    const output = lastToolResult(messages)
    if (!/\bpass\b/i.test(output)) throw new Error(`The real Shell tool did not return a passing test result: ${output}`)
    if (readFileSync(`${workspace}/src/signup.js`, 'utf8').trim() !== UPDATED_SOURCE.trim() || readFileSync(`${workspace}/tests/signup.test.js`, 'utf8').trim() !== UPDATED_TESTS.trim()) {
      throw new Error('The demo workspace changed after the expected writes.')
    }
  }
}

function answer(index: number): Response {
  if (index < TOOL_CALLS.length) return toolResponse(index)
  const text = 'Email validation is now part of the signup flow, with focused coverage for valid, malformed, whitespace-padded, and non-string input. The full test suite passes in the isolated workspace.'
  const parts = text.match(/.{1,8}/g) ?? [text]
  return stream(parts.map((content, index) => completionChunk({ ...(index === 0 ? { role: 'assistant' } : {}), content }, index === parts.length - 1 ? 'stop' : null)))
}

export function startMockProvider(workspace: string): { baseURL: string; state: MockProviderState; close: () => void } {
  const state: MockProviderState = { requests: 0, finished: false }
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async request => {
      const path = new URL(request.url).pathname
      if (path === '/health') return Response.json({ ok: true })
      if (path === '/v1/user/balance') return Response.json({ balance_infos: [{ currency: 'USD', total_balance: '0' }] })
      if (path === '/v1/models') return Response.json({ data: [{ id: 'deepseek-flash', object: 'model' }] })
      if (path !== '/v1/chat/completions' || request.method !== 'POST') return new Response('Not found', { status: 404 })

      try {
        if (request.headers.get('authorization') !== 'Bearer demo-only-key') throw new Error('The CLI did not use the isolated demo credential.')
        const body = await request.json() as ChatRequest
        const index = state.requests
        if (body.model !== 'deepseek-flash') throw new Error(`Unexpected model ${body.model}.`)
        if (body.stream !== true && state.finished) {
          return Response.json({
            id: 'demo-metadata',
            object: 'chat.completion',
            created: 1,
            model: 'deepseek-flash',
            choices: [{ index: 0, message: { role: 'assistant', content: 'Signup email validation demo' }, finish_reason: 'stop' }],
          })
        }
        if (body.stream !== true) throw new Error(`Unexpected non-streaming model request at stage ${index}.`)
        if (index > TOOL_CALLS.length) throw new Error('The CLI made an unexpected additional model request.')
        assertStage(index, body, workspace)
        await Bun.sleep(1100 + (index % 3) * 250)
        state.requests++
        if (index === TOOL_CALLS.length) state.finished = true
        return answer(index)
      } catch (error) {
        state.failure = error instanceof Error ? error.message : String(error)
        return Response.json({ error: { message: state.failure } }, { status: 500 })
      }
    },
  })
  return { baseURL: `http://127.0.0.1:${server.port}/v1`, state, close: () => server.stop(true) }
}
