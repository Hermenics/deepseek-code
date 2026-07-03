import { describe, it, expect } from 'bun:test'
import { parseSkillCommand } from '../../src/commands/skill/index.js'

describe('parseSkillCommand', () => {
  describe('install', () => {
    it('should parse install with valid owner/repo', () => {
      const result = parseSkillCommand(['install', 'openai/codex-plugin-cc'])
      expect(result).toEqual({ type: 'skill', action: 'install', repo: 'openai/codex-plugin-cc' })
    })

    it('should parse install with repo containing dots and underscores', () => {
      const result = parseSkillCommand(['install', 'my.org/my_skill'])
      expect(result).toEqual({ type: 'skill', action: 'install', repo: 'my.org/my_skill' })
    })

    it('should return error when install has no repo argument', () => {
      const result = parseSkillCommand(['install'])
      expect(result).toHaveProperty('type', 'skill')
      expect(result).toHaveProperty('action', 'error')
    })

    it('should return error when repo format is invalid (no slash)', () => {
      const result = parseSkillCommand(['install', 'invalidrepoformat'])
      expect(result).toHaveProperty('type', 'skill')
      expect(result).toHaveProperty('action', 'error')
    })

    it('should return error when repo has empty owner', () => {
      const result = parseSkillCommand(['install', '/skill-name'])
      expect(result).toHaveProperty('type', 'skill')
      expect(result).toHaveProperty('action', 'error')
    })

    it('should return error when repo has empty name', () => {
      const result = parseSkillCommand(['install', 'owner/'])
      expect(result).toHaveProperty('type', 'skill')
      expect(result).toHaveProperty('action', 'error')
    })

    it('should return error when repo has special characters', () => {
      const result = parseSkillCommand(['install', 'owner/repo!name'])
      expect(result).toHaveProperty('type', 'skill')
      expect(result).toHaveProperty('action', 'error')
    })
  })

  describe('list', () => {
    it('should parse list command', () => {
      const result = parseSkillCommand(['list'])
      expect(result).toEqual({ type: 'skill', action: 'list' })
    })

    it('should parse list command ignoring extra args', () => {
      const result = parseSkillCommand(['list', 'extra'])
      expect(result).toEqual({ type: 'skill', action: 'list' })
    })
  })

  describe('remove', () => {
    it('should parse remove with skill name', () => {
      const result = parseSkillCommand(['remove', 'my-skill'])
      expect(result).toEqual({ type: 'skill', action: 'remove', name: 'my-skill' })
    })

    it('should return error when remove has no name', () => {
      const result = parseSkillCommand(['remove'])
      expect(result).toHaveProperty('type', 'skill')
      expect(result).toHaveProperty('action', 'error')
    })
  })

  describe('update', () => {
    it('should parse update with skill name', () => {
      const result = parseSkillCommand(['update', 'my-skill'])
      expect(result).toEqual({ type: 'skill', action: 'update', name: 'my-skill' })
    })

    it('should return error when update has no name', () => {
      const result = parseSkillCommand(['update'])
      expect(result).toHaveProperty('type', 'skill')
      expect(result).toHaveProperty('action', 'error')
    })
  })

  describe('help / no args', () => {
    it('should return help when no args given', () => {
      const result = parseSkillCommand([])
      expect(result).toEqual({ type: 'skill', action: 'help' })
    })

    it('should return help for unknown subcommand', () => {
      const result = parseSkillCommand(['foobar'])
      expect(result).toHaveProperty('type', 'skill')
      expect(result).toHaveProperty('action', 'help')
    })
  })
})
