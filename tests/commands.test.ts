import { describe, it, expect } from 'bun:test'
import { parseCommand } from '../src/commands.js'

describe('parseCommand', () => {
  it('returns null for non-commands', () => {
    expect(parseCommand('hello')).toBeNull()
    expect(parseCommand('')).toBeNull()
  })

  it('parses /quit and /q', () => {
    expect(parseCommand('/quit')).toEqual({ type: 'quit' })
    expect(parseCommand('/q')).toEqual({ type: 'quit' })
  })

  it('parses /clear', () => {
    expect(parseCommand('/clear')).toEqual({ type: 'clear' })
  })

  it('parses /help', () => {
    expect(parseCommand('/help')).toEqual({ type: 'help' })
  })

  it('parses /agents', () => {
    expect(parseCommand('/agents')).toEqual({ type: 'agents' })
  })

  it('parses /theme', () => {
    expect(parseCommand('/theme')).toEqual({ type: 'theme' })
  })

  it('parses /agent <name>', () => {
    expect(parseCommand('/agent rust-expert')).toEqual({ type: 'agent', name: 'rust-expert' })
  })

  it('returns unknown for /agent without name', () => {
    const result = parseCommand('/agent')
    expect(result?.type).toBe('unknown')
  })

  it('parses /model deepseek-chat', () => {
    expect(parseCommand('/model deepseek-chat')).toEqual({ type: 'model', model: 'deepseek-chat' })
  })

  it('parses /model deepseek-reasoner', () => {
    expect(parseCommand('/model deepseek-reasoner')).toEqual({ type: 'model', model: 'deepseek-reasoner' })
  })

  it('accepts any model string (no hardcoded validation)', () => {
    expect(parseCommand('/model gpt-4')).toEqual({ type: 'model', model: 'gpt-4' })
  })

  it('parses /model with any string model name', () => {
    expect(parseCommand('/model deepseek-v4-flash')).toEqual({ type: 'model', model: 'deepseek-v4-flash' })
  })

  it('parses /model with arbitrary model name', () => {
    expect(parseCommand('/model llama3')).toEqual({ type: 'model', model: 'llama3' })
  })

  it('returns unknown for /model without argument', () => {
    const result = parseCommand('/model')
    expect(result?.type).toBe('unknown')
  })

  it('returns unknown for /model with empty space', () => {
    const result = parseCommand('/model ')
    expect(result?.type).toBe('unknown')
  })

  it('parses /model with special characters (dots, colon, version suffix)', () => {
    const model = 'anthropic.claude-3-5-sonnet-20241022-v2:0'
    expect(parseCommand(`/model ${model}`)).toEqual({ type: 'model', model })
  })

  it('parses /model with slash (provider/model format)', () => {
    const model = 'google/gemini-2.0-flash-001'
    // split on whitespace — the slash is part of the first token
    expect(parseCommand(`/model ${model}`)).toEqual({ type: 'model', model })
  })

  it('returns unknown for unknown commands', () => {
    const result = parseCommand('/foobar')
    expect(result?.type).toBe('unknown')
  })
})
