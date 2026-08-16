import { describe, it, expect } from 'bun:test'
import { pickLoadingMessage } from '../src/ui/input/render/LoadingSpinner.js'
import { previewStreamingArgs, previewToolCallArgs, summarizeAskUserPayload, summarizeStructuredPayload } from '../src/ui/messages/toolDisplay.js'

describe('pickLoadingMessage', () => {
  it('uses the tool-specific pun while a tool is in flight', () => {
    expect(pickLoadingMessage('executing', 0, 'git')).toBe('Running git blame on you...')
    expect(pickLoadingMessage('executing', 1, 'write_file')).toBe('Committing fresh bugs to disk...')
  })

  it('falls back to the generic puns with no active tool', () => {
    expect(pickLoadingMessage('executing', 0, null)).toBe('Consulting the code gods...')
  })

  it('falls back for an unknown tool name', () => {
    expect(pickLoadingMessage('executing', 0, 'mcp__whatever__thing')).toBe('Consulting the code gods...')
  })

  it('refining beats any active tool', () => {
    expect(pickLoadingMessage('refining', 0, 'git')).toBe('Prompt-engineering your prompt...')
  })
})

describe('previewStreamingArgs', () => {
  it('extracts a key field from unterminated JSON', () => {
    expect(previewStreamingArgs('{"path":"src/ui/App.tsx","content":"const x')).toBe('src/ui/App.tsx')
  })

  it('returns empty while the first field is still streaming', () => {
    expect(previewStreamingArgs('{"path":"src/ui/Ap')).toBe('')
  })

  it('ignores fields that are not preview-worthy', () => {
    expect(previewStreamingArgs('{"content":"hello","path":"a.ts"}')).toBe('a.ts')
  })

  it('truncates long values', () => {
    const long = 'x'.repeat(200)
    expect(previewStreamingArgs(`{"command":"${long}"}`)).toHaveLength(61)
  })

  it('is safe on empty input', () => {
    expect(previewStreamingArgs('')).toBe('')
  })
})

describe('AskUserQuestions tool previews', () => {
  it('shows the question instead of streaming the raw arguments', () => {
    const preview = previewToolCallArgs('ask_user_questions', {
      questions: [{ question: 'O que você quer atacar hoje no DeepSeek Code?', header: 'Prioridade' }],
    })
    expect(preview).toBe('O que você quer atacar hoje no DeepSeek Code?')
    expect(preview).not.toContain('{')
  })

  it('summarizes completed and cancelled payloads', () => {
    expect(summarizeAskUserPayload('{"answers":{"0":"Bun","1":"Fast"},"cancelled":false}')).toBe('2 answers')
    expect(summarizeAskUserPayload('{"cancelled":true,"answers":{}}')).toBe('cancelled')
    expect(summarizeAskUserPayload('null')).toBe('null')
    expect(summarizeAskUserPayload('[]')).toBe('[]')
  })

  it('keeps the complete question count suffix when the question is truncated', () => {
    const preview = summarizeAskUserPayload(JSON.stringify({ questions: [
      { question: 'A very long question that should be truncated before the count suffix is added.' },
      { question: 'Second question' },
    ] }))
    expect(preview).toEndWith(' · 2 questions')
    expect(preview).toHaveLength(60)
  })

  it('never falls back to raw JSON for other tools', () => {
    expect(previewToolCallArgs('write_file', { path: 'src/App.tsx', content: 'const x = 1' })).toBe('src/App.tsx')
    expect(previewToolCallArgs('unknown_tool', { payload: { nested: true } })).toBe('1 argument')
    expect(previewToolCallArgs('unknown_tool', { payload: { nested: true } })).not.toContain('{')
  })

  it('summarizes structured results without exposing their JSON', () => {
    expect(summarizeStructuredPayload('{"status":"active","runId":"run-1"}')).toBe('2 fields')
    expect(summarizeStructuredPayload('["one","two"]')).toBe('2 items')
    expect(summarizeStructuredPayload('{"error":"failed safely"}')).toBe('Error: failed safely')
  })
})
