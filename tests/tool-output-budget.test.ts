import { expect, it } from 'bun:test'
import { bedrockToolResultEnvelopeBytes, boundBedrockToolResults, boundToolMessages, nativeToolBatchFitsBudget, nativeToolCallPayloadBytes, nativeToolResultEnvelopeBytes, TOOL_BATCH_CHARS, TOOL_BATCH_BYTES } from '../src/agent/toolOutputBudget.js'
import { enhancedMicroCompact } from '../src/services/compact/microCompact.js'
import { isGraphemeBoundary } from '../src/utils/textBoundaries.js'

it('bounds aggregate output without dropping tool-call pairing or source references', () => {
  const reference = '[Session evidence: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa]'
  const messages = Array.from({ length: 12 }, (_, index) => ({ role: 'tool' as const, tool_call_id: String(index), content: '😀'.repeat(20000) + reference }))
  const bounded = boundToolMessages(messages)
  expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(TOOL_BATCH_BYTES)
  bounded.forEach((message, index) => {
    expect(message).toMatchObject({ tool_call_id: String(index) })
    expect(message.content).toContain(reference)
    expect(message.content).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u)
  })
  expect(messages[0]!.content.length).toBeGreaterThan(TOOL_BATCH_CHARS)
})

it('truncates tool results only at complete grapheme boundaries', () => {
  const source = `${'e\u0301'.repeat(20_000)}[Session evidence: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa]`
  const bounded = boundToolMessages([{ role: 'tool', tool_call_id: 'combining', content: source }])
  const content = bounded[0]!.content as string
  const boundary = content.indexOf('\n[Batch output budget exhausted;')

  expect(boundary).toBeGreaterThan(0)
  expect(isGraphemeBoundary(source, boundary)).toBe(true)
  expect(content).toContain('[Session evidence: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa]')
})

it('keeps the cap even for an excessively large batch', () => {
  const messages = Array.from({ length: 100 }, (_, index) => ({ role: 'tool' as const, tool_call_id: String(index), name: 'write_file', content: 'x'.repeat(1000) }))
  const bounded = boundToolMessages(messages)
  expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(TOOL_BATCH_BYTES)
  expect(bounded.length).toBe(messages.length)
})

it('rejects a batch whose tool-result envelopes alone exceed the payload cap', () => {
  const messages = Array.from({ length: 200 }, (_, index) => ({ role: 'tool' as const, tool_call_id: `${index}-${'x'.repeat(240)}`, content: '' }))
  expect(() => boundToolMessages(messages)).toThrow('cannot fit even empty serialized results')
})

it('recovers an oversized structured JSON result without changing the original tool contract', () => {
  const id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
  const original = JSON.stringify({ values: ['x'.repeat(60000)] })
  const messages = [{ role: 'tool' as const, tool_call_id: 'json-call', content: original }]
  const bounded = boundToolMessages(messages, call => call === 'json-call' ? id : undefined)
  expect(bounded[0]!.content).toContain(`[Session evidence: ${id}]`)
  expect(bounded[0]!.content).not.toContain('Legacy result')
  expect(messages[0]!.content).toBe(original)
  expect(JSON.parse(messages[0]!.content).values[0]).toHaveLength(60000)
})

it('retains evidence references when micro-compaction clears the preview', () => {
  const untrustedReference = '[Session evidence: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa]'
  const trustedEvidenceId = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
  const trustedReference = `[Session evidence: ${trustedEvidenceId}]`
  const result = enhancedMicroCompact([
    { role: 'assistant', tool_calls: [{ id: 'read', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'read', content: 'x'.repeat(1000) + untrustedReference },
  ], { keepLastN: 0, evidenceForCall: () => trustedEvidenceId })
  const compacted = JSON.stringify(result.messages[1])
  expect(compacted).toContain(trustedReference)
  expect(compacted.includes(untrustedReference)).toBe(false)
  expect(result.freedTokensEstimate).toBeGreaterThan(0)
})


it('caps serialized UTF-8 content including Unicode, JSON escaping and structured historical results', () => {
  const messages = [
    { role: 'tool' as const, tool_call_id: 'unicode', content: '界😀'.repeat(20000) },
    { role: 'tool' as const, tool_call_id: 'escaped', content: '\"\\\n'.repeat(20000) },
    { role: 'tool' as const, tool_call_id: 'structured', content: [{ type: 'text' as const, text: '界'.repeat(30000) }] },
  ]
  const bounded = boundToolMessages(messages)
  expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(TOOL_BATCH_BYTES)
  expect(bounded.map(message => (message as any).tool_call_id)).toEqual(['unicode', 'escaped', 'structured'])
  expect(messages[2]!.content).toBeArray()
})

it('shares one byte cap between paired tool-call arguments and serialized results', () => {
  const argumentsPayload = JSON.stringify({ path: 'x'.repeat(12_000) })
  const messages = [
    { role: 'assistant' as const, content: null, tool_calls: [{ id: 'round-trip', type: 'function' as const, function: { name: 'read_file', arguments: argumentsPayload } }] },
    { role: 'tool' as const, tool_call_id: 'round-trip', content: 'result'.repeat(20_000) },
  ]
  const bounded = boundToolMessages(messages)
  expect(Buffer.byteLength(argumentsPayload, 'utf8') + Buffer.byteLength(JSON.stringify([bounded[1]]), 'utf8')).toBeLessThanOrEqual(TOOL_BATCH_BYTES)
  expect(bounded[1]!.content).toContain('[Batch output budget exhausted; recover source using session_evidence.]')
})

it('counts JSON escaping in the serialized native tool-call payload before dispatch', () => {
  const call = {
    id: 'escaped-argument',
    type: 'function' as const,
    function: { name: 'write_file', arguments: JSON.stringify({ content: '\\'.repeat(10_000) }) },
  }
  const rawArgumentsBytes = Buffer.byteLength(call.function.arguments, 'utf8')
  const serializedCallBytes = Buffer.byteLength(JSON.stringify([call]), 'utf8')
  const emptyResultsBytes = nativeToolResultEnvelopeBytes([call.id])

  expect(rawArgumentsBytes + emptyResultsBytes).toBeLessThanOrEqual(TOOL_BATCH_BYTES)
  expect(serializedCallBytes + emptyResultsBytes).toBeGreaterThan(TOOL_BATCH_BYTES)
  expect(nativeToolBatchFitsBudget([call])).toBe(false)
})

it('counts native tool-call metadata with serialized result envelopes when bounding history', () => {
  const call = {
    id: 'i'.repeat(20_000),
    type: 'function' as const,
    function: { name: 'read_file', arguments: '{}' },
  }
  const result = { role: 'tool' as const, tool_call_id: call.id, content: '' }
  const serializedCallBytes = Buffer.byteLength(JSON.stringify([call]), 'utf8')
  const serializedResultBytes = Buffer.byteLength(JSON.stringify([result]), 'utf8')

  expect(Buffer.byteLength(call.function.arguments, 'utf8') + serializedResultBytes).toBeLessThanOrEqual(TOOL_BATCH_BYTES)
  expect(serializedCallBytes + serializedResultBytes).toBeGreaterThan(TOOL_BATCH_BYTES)
  expect(() => boundToolMessages([
    { role: 'assistant', content: null, tool_calls: [call] },
    result,
  ])).toThrow()
})

it('includes custom tool-call input in its paired historical batch budget', () => {
  const call = {
    id: 'oversized-custom',
    type: 'custom',
    custom: { name: 'custom_op', input: 'x'.repeat(41_000) },
  }
  const result = { role: 'tool' as const, tool_call_id: call.id, content: '' }
  const serializedCallBytes = nativeToolCallPayloadBytes([call])
  const emptyResultEnvelopeBytes = nativeToolResultEnvelopeBytes([call.id])

  expect(serializedCallBytes).toBeGreaterThan(TOOL_BATCH_BYTES)
  expect(serializedCallBytes + emptyResultEnvelopeBytes).toBeGreaterThan(TOOL_BATCH_BYTES)
  let failure: unknown
  try {
    boundToolMessages([
      { role: 'assistant', content: null, tool_calls: [call] as any },
      result,
    ])
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(Error)
})

it('pairs repeated tool-call IDs with their immediately preceding assistant batch', () => {
  const firstArguments = JSON.stringify({ content: 'a'.repeat(30_000) })
  const secondArguments = '{}'
  const messages = [
    { role: 'assistant' as const, content: null, tool_calls: [{ id: 'reused', type: 'function' as const, function: { name: 'read_file', arguments: firstArguments } }] },
    { role: 'tool' as const, tool_call_id: 'reused', content: 'x'.repeat(15_000) },
    { role: 'assistant' as const, content: null, tool_calls: [{ id: 'reused', type: 'function' as const, function: { name: 'read_file', arguments: secondArguments } }] },
    { role: 'tool' as const, tool_call_id: 'reused', content: 'y'.repeat(15_000) },
  ]

  const bounded = boundToolMessages(messages)
  const firstResult = bounded[1]!
  const secondResult = bounded[3]!

  expect(firstResult.content).toContain('[Batch output budget exhausted; recover source using session_evidence.]')
  expect(Buffer.byteLength(firstArguments, 'utf8') + Buffer.byteLength(JSON.stringify([firstResult]), 'utf8')).toBeLessThanOrEqual(TOOL_BATCH_BYTES)
  expect(Buffer.byteLength(secondArguments, 'utf8') + Buffer.byteLength(JSON.stringify([secondResult]), 'utf8')).toBeLessThanOrEqual(TOOL_BATCH_BYTES)
})

it('caps Bedrock XML tool results against retained prompt call blocks without breaking the wrapper', () => {
  const names = ['read_file', 'shell']
  const results = names.map(name => ({ name, result: 'large result '.repeat(5_000) }))
  const inputBytes = 12_000
  const bounded = boundBedrockToolResults(results, inputBytes)
  const outputBytes = Buffer.byteLength(JSON.stringify(bounded.map(content => ({ role: 'user', content }))), 'utf8')
  expect(inputBytes + outputBytes).toBeLessThanOrEqual(TOOL_BATCH_BYTES)
  for (let index = 0; index < bounded.length; index++) {
    expect(bounded[index]).toContain(`<name>${names[index]}</name>`)
    expect(bounded[index]).toContain('<result>')
    expect(bounded[index]).toContain('</result>')
    expect(bounded[index]).toEndWith('</tool_result>')
  }
})

it('rejects Bedrock batches whose required result wrappers alone exceed the cap', () => {
  const names = Array.from({ length: 1_000 }, () => 'tool'.repeat(20))
  expect(bedrockToolResultEnvelopeBytes(names)).toBeGreaterThan(TOOL_BATCH_BYTES)
  expect(boundBedrockToolResults(names.map(name => ({ name, result: 'must not execute' })), 0)).toEqual([
    '[Tool batch rejected before execution: required result envelopes exceed the round-trip budget. Split the calls.]',
  ])
})


it('rejects a batch whose required empty JSON strings already exceed the payload cap', () => {
  const messages = Array.from({ length: TOOL_BATCH_BYTES / 2 + 1 }, (_, index) => ({ role: 'tool' as const, tool_call_id: String(index), content: '' }))
  expect(() => boundToolMessages(messages)).toThrow('cannot fit even empty serialized results')
})
