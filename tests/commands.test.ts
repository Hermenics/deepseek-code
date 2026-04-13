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

  it('returns unknown for invalid model', () => {
    const result = parseCommand('/model gpt-4')
    expect(result?.type).toBe('unknown')
  })

  it('returns unknown for unknown commands', () => {
    const result = parseCommand('/foobar')
    expect(result?.type).toBe('unknown')
  })
})
