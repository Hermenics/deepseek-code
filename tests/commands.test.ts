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

  it('parses /config', () => {
    expect(parseCommand('/config')).toEqual({ type: 'config' })
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

  it('returns models selector for /model without argument', () => {
    const result = parseCommand('/model')
    expect(result?.type).toBe('models')
  })

  it('returns models selector for /model with empty space', () => {
    const result = parseCommand('/model ')
    expect(result?.type).toBe('models')
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

describe('parseCommand — context', () => {
  it('parses /context', () => {
    expect(parseCommand('/context')).toEqual({ type: 'context' })
  })

  it('parses /ctx alias', () => {
    expect(parseCommand('/ctx')).toEqual({ type: 'context' })
  })
})

describe('parseCommand — worktree', () => {
  it('parses /worktree with no args → create', () => {
    expect(parseCommand('/worktree')).toEqual({ type: 'worktree', action: 'create' })
  })

  it('parses /wt alias → create', () => {
    expect(parseCommand('/wt')).toEqual({ type: 'worktree', action: 'create' })
  })

  it('parses /worktree exit → keep: false', () => {
    expect(parseCommand('/worktree exit')).toEqual({ type: 'worktree', action: 'exit', keep: false })
  })

  it('parses /worktree exit keep → keep: true', () => {
    expect(parseCommand('/worktree exit keep')).toEqual({ type: 'worktree', action: 'exit', keep: true })
  })

  it('parses /worktree enter swift-fox', () => {
    expect(parseCommand('/worktree enter swift-fox')).toEqual({ type: 'worktree', action: 'enter', name: 'swift-fox' })
  })

  it('parses /worktree list', () => {
    expect(parseCommand('/worktree list')).toEqual({ type: 'worktree', action: 'list' })
  })

  it('parses /worktree ls alias', () => {
    expect(parseCommand('/worktree ls')).toEqual({ type: 'worktree', action: 'list' })
  })

  it('parses /worktree status', () => {
    expect(parseCommand('/worktree status')).toEqual({ type: 'worktree', action: 'status' })
  })

  it('parses /worktree leave as exit', () => {
    expect(parseCommand('/worktree leave')).toEqual({ type: 'worktree', action: 'exit', keep: false })
  })
})
