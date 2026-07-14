import { describe, it, expect } from 'bun:test'
import { parseCommand, COMMAND_SUGGESTIONS, HELP_TEXT } from '../src/commands.js'

describe('parseCommand — extended coverage', () => {
  describe('basic commands', () => {
    it('should parse /compact', () => {
      expect(parseCommand('/compact')).toEqual({ type: 'compact' })
    })

    it('should parse /undo', () => {
      expect(parseCommand('/undo')).toEqual({ type: 'undo' })
    })

    it('should parse /retry', () => {
      expect(parseCommand('/retry')).toEqual({ type: 'retry' })
    })

    it('should parse /cost', () => {
      expect(parseCommand('/cost')).toEqual({ type: 'cost' })
    })

    it('should parse /files', () => {
      expect(parseCommand('/files')).toEqual({ type: 'files' })
    })

    it('should parse /tools', () => {
      expect(parseCommand('/tools')).toEqual({ type: 'tools' })
    })

    it('should parse /system', () => {
      expect(parseCommand('/system')).toEqual({ type: 'system' })
    })

    it('should return unknown for /models (not a valid command)', () => {
      expect(parseCommand('/models')).toEqual({ type: 'unknown', input: 'Unknown command: /models. Use /help to see available commands.' })
    })

    it('should parse /config', () => {
      expect(parseCommand('/config')).toEqual({ type: 'config' })
    })

    it('should parse /sessions', () => {
      expect(parseCommand('/sessions')).toEqual({ type: 'sessions' })
    })
  })

  describe('checkpoint commands', () => {
    it('should parse /checkpoint (defaults to save)', () => {
      expect(parseCommand('/checkpoint')).toEqual({ type: 'checkpoint', action: 'save', label: undefined })
    })

    it('should parse /checkpoint save', () => {
      expect(parseCommand('/checkpoint save')).toEqual({ type: 'checkpoint', action: 'save', label: undefined })
    })

    it('should parse /checkpoint save with label', () => {
      expect(parseCommand('/checkpoint save meu ponto')).toEqual({ type: 'checkpoint', action: 'save', label: 'meu ponto' })
    })

    it('should parse /checkpoint list', () => {
      expect(parseCommand('/checkpoint list')).toEqual({ type: 'checkpoint', action: 'list' })
    })

    it('should parse /checkpoint restore with id', () => {
      expect(parseCommand('/checkpoint restore abc123')).toEqual({ type: 'checkpoint', action: 'restore', id: 'abc123' })
    })

    it('should return unknown for /checkpoint restore without id', () => {
      const result = parseCommand('/checkpoint restore')
      expect(result?.type).toBe('unknown')
    })

    it('should return unknown for invalid checkpoint subcommand', () => {
      const result = parseCommand('/checkpoint invalid')
      expect(result?.type).toBe('unknown')
    })
  })

  describe('plan command', () => {
    it('should parse /plan with task', () => {
      expect(parseCommand('/plan add auth system')).toEqual({ type: 'plan', task: 'add auth system' })
    })

    it('should return unknown for /plan without task', () => {
      const result = parseCommand('/plan')
      expect(result?.type).toBe('unknown')
    })
  })

  describe('review command', () => {
    it('should parse /review with target', () => {
      expect(parseCommand('/review src/agent.ts')).toEqual({ type: 'review', target: 'src/agent.ts' })
    })

    it('should parse /review without target (empty string)', () => {
      expect(parseCommand('/review')).toEqual({ type: 'review', target: '' })
    })
  })

  describe('msg/btw command', () => {
    it('should parse /msg with note', () => {
      expect(parseCommand('/msg fix the bug later')).toEqual({ type: 'msg', note: 'fix the bug later' })
    })

    it('should parse /btw as alias for /msg', () => {
      expect(parseCommand('/btw use TypeScript strict mode')).toEqual({ type: 'msg', note: 'use TypeScript strict mode' })
    })

    it('should return unknown for /msg without note', () => {
      const result = parseCommand('/msg')
      expect(result?.type).toBe('unknown')
    })
  })

  describe('vim command', () => {
    it('should parse /vim', () => {
      expect(parseCommand('/vim')).toEqual({ type: 'vim' })
    })
  })

  describe('stats command', () => {
    it('should parse /stats', () => {
      expect(parseCommand('/stats')).toEqual({ type: 'stats' })
    })
  })

  describe('permissions command', () => {
    it('should parse /permissions', () => {
      expect(parseCommand('/permissions')).toEqual({ type: 'permissions' })
    })
  })

  describe('edge cases', () => {
    it('should return null for empty string', () => {
      expect(parseCommand('')).toBeNull()
    })

    it('should return null for whitespace only', () => {
      expect(parseCommand('   ')).toBeNull()
    })

    it('should return null for text without slash', () => {
      expect(parseCommand('hello world')).toBeNull()
    })

    it('should handle extra whitespace around command', () => {
      expect(parseCommand('  /quit  ')).toEqual({ type: 'quit' })
    })

    it('should handle multiple spaces between args', () => {
      expect(parseCommand('/agent   my-agent')).toEqual({ type: 'agent', name: 'my-agent' })
    })

    it('should return unknown for slash only', () => {
      const result = parseCommand('/')
      expect(result?.type).toBe('unknown')
    })
  })
})

describe('COMMAND_SUGGESTIONS', () => {
  it('should be a non-empty array', () => {
    expect(COMMAND_SUGGESTIONS).toBeArray()
    expect(COMMAND_SUGGESTIONS.length).toBeGreaterThan(10)
  })

  it('should all start with /', () => {
    for (const cmd of COMMAND_SUGGESTIONS) {
      expect(cmd.startsWith('/')).toBe(true)
    }
  })

  it('should include essential commands', () => {
    expect(COMMAND_SUGGESTIONS).toContain('/quit')
    expect(COMMAND_SUGGESTIONS).toContain('/help')
    expect(COMMAND_SUGGESTIONS).toContain('/clear')
    expect(COMMAND_SUGGESTIONS).toContain('/agent')
  })
})

describe('HELP_TEXT', () => {
  it('should be a non-empty string', () => {
    expect(typeof HELP_TEXT).toBe('string')
    expect(HELP_TEXT.length).toBeGreaterThan(100)
  })

  it('should mention key commands', () => {
    expect(HELP_TEXT).toContain('/quit')
    expect(HELP_TEXT).toContain('/agent')
    expect(HELP_TEXT).toContain('/checkpoint')
    expect(HELP_TEXT).toContain('/plan')
  })
})
