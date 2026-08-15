import { describe, it, expect } from 'bun:test'
import {
  extractEventStreamPayloads,
  bedrockChunkToOpenAiChunk,
  eventStreamToSse,
} from '../src/agent/providers/bedrock'

/** Builds one AWS event-stream frame with empty headers around a payload. */
function encodeFrame(payload: string): Uint8Array {
  const payloadBytes = new TextEncoder().encode(payload)
  const totalLen = 12 + payloadBytes.byteLength + 4
  const frame = new Uint8Array(totalLen)
  const view = new DataView(frame.buffer)
  view.setUint32(0, totalLen)
  view.setUint32(4, 0) // headers length
  // prelude CRC (8..12) and message CRC (last 4) left as zeros — not validated
  frame.set(payloadBytes, 12)
  return frame
}

function chunkPayload(inner: object): string {
  return JSON.stringify({ bytes: Buffer.from(JSON.stringify(inner)).toString('base64') })
}

describe('extractEventStreamPayloads', () => {
  it('extracts a single complete frame', () => {
    const { payloads, rest } = extractEventStreamPayloads(encodeFrame('{"a":1}'))
    expect(payloads).toEqual(['{"a":1}'])
    expect(rest.byteLength).toBe(0)
  })

  it('extracts multiple frames and keeps the incomplete tail', () => {
    const f1 = encodeFrame('{"a":1}')
    const f2 = encodeFrame('{"b":2}')
    const partial = f2.subarray(0, 10)
    const buf = new Uint8Array(f1.byteLength + partial.byteLength)
    buf.set(f1)
    buf.set(partial, f1.byteLength)
    const { payloads, rest } = extractEventStreamPayloads(buf)
    expect(payloads).toEqual(['{"a":1}'])
    expect(rest.byteLength).toBe(10)
  })

  it('returns everything as rest when the buffer is too short', () => {
    const { payloads, rest } = extractEventStreamPayloads(new Uint8Array([0, 0]))
    expect(payloads).toEqual([])
    expect(rest.byteLength).toBe(2)
  })
})

describe('bedrockChunkToOpenAiChunk', () => {
  it('passes through OpenAI delta chunks decoded from bytes', () => {
    const chunk = bedrockChunkToOpenAiChunk(
      chunkPayload({ choices: [{ delta: { content: 'oi' }, index: 0 }] }),
      'r1',
    )
    expect((chunk as any).choices[0].delta.content).toBe('oi')
  })

  it('wraps native text-completion chunks as deltas', () => {
    const chunk = bedrockChunkToOpenAiChunk(
      chunkPayload({ choices: [{ text: 'hello', stop_reason: null }] }),
      'r1',
    )
    expect((chunk as any).choices[0].delta.content).toBe('hello')
    expect((chunk as any).object).toBe('chat.completion.chunk')
  })

  it('wraps chat-message chunks with reasoning as deltas', () => {
    const chunk = bedrockChunkToOpenAiChunk(
      chunkPayload({ choices: [{ message: { content: 'x', reasoning_content: 'pensei' } }] }),
      'r1',
    )
    expect((chunk as any).choices[0].delta.reasoning_content).toBe('pensei')
  })

  it('maps invocation metrics to usage', () => {
    const chunk = bedrockChunkToOpenAiChunk(
      chunkPayload({
        choices: [{ text: '', stop_reason: 'stop' }],
        'amazon-bedrock-invocationMetrics': { inputTokenCount: 10, outputTokenCount: 5 },
      }),
      'r1',
    )
    expect((chunk as any).usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 })
    expect((chunk as any).choices[0].finish_reason).toBe('stop')
  })

  it('throws on exception payloads', () => {
    expect(() => bedrockChunkToOpenAiChunk('{"message":"Throttled"}', 'r1')).toThrow('Throttled')
  })

  it('returns null for unrecognized payloads', () => {
    expect(bedrockChunkToOpenAiChunk('{"weird":true}', 'r1')).toBeNull()
    expect(bedrockChunkToOpenAiChunk('not json', 'r1')).toBeNull()
  })
})

describe('eventStreamToSse', () => {
  it('converts a full event stream body into SSE ending with [DONE]', async () => {
    const frames = [
      encodeFrame(chunkPayload({ choices: [{ text: 'Hel' }] })),
      encodeFrame(chunkPayload({ choices: [{ text: 'lo' }] })),
    ]
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const f of frames) controller.enqueue(f)
        controller.close()
      },
    })
    const sse = await new Response(eventStreamToSse(body, 'r1')).text()
    const events = sse.split('\n\n').filter(Boolean)
    expect(events).toHaveLength(3)
    expect(JSON.parse(events[0]!.slice(6)).choices[0].delta.content).toBe('Hel')
    expect(JSON.parse(events[1]!.slice(6)).choices[0].delta.content).toBe('lo')
    expect(events[2]).toBe('data: [DONE]')
  })

  it('fails the stream with the original error and cancels the upstream reader', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encodeFrame('{"message":"Throttled"}'))
      },
      cancel() { cancelled = true },
    })
    await expect(new Response(eventStreamToSse(body, 'r1')).text()).rejects.toThrow('Throttled')
    expect(cancelled).toBe(true)
  })

  it('handles frames split across reads', async () => {
    const frame = encodeFrame(chunkPayload({ choices: [{ text: 'split' }] }))
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(frame.subarray(0, 7))
        controller.enqueue(frame.subarray(7))
        controller.close()
      },
    })
    const sse = await new Response(eventStreamToSse(body, 'r1')).text()
    expect(sse).toContain('"content":"split"')
    expect(sse).toContain('data: [DONE]')
  })
})
