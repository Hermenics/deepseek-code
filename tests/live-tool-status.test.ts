import { describe, it, expect } from 'bun:test'
import { pickLoadingMessage } from '../src/ui/input/render/LoadingSpinner.js'
import { previewStreamingArgs } from '../src/ui/messages/toolDisplay.js'

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
