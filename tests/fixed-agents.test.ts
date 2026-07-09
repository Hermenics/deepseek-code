import { describe, it, expect } from 'bun:test'
import {
  isFixedAgent,
  getFixedAgent,
  buildFixedAgentPrompt,
  FIXED_AGENTS,
  type FixedAgentName,
} from '../src/tools/SubAgent/fixedAgents.js'

describe('fixedAgents', () => {
  describe('isFixedAgent', () => {
    it('returns true for valid fixed agent names', () => {
      expect(isFixedAgent('coder')).toBe(true)
      expect(isFixedAgent('reviewer')).toBe(true)
      expect(isFixedAgent('tester')).toBe(true)
    })

    it('returns false for unknown names', () => {
      expect(isFixedAgent('reader')).toBe(false)
      expect(isFixedAgent('executor')).toBe(false)
      expect(isFixedAgent('')).toBe(false)
    })

    it('is case-sensitive', () => {
      expect(isFixedAgent('CODER')).toBe(false)
      expect(isFixedAgent('Reviewer')).toBe(false)
    })
  })

  describe('getFixedAgent', () => {
    it('returns coder with executor role', () => {
      const agent = getFixedAgent('coder')
      expect(agent.name).toBe('coder')
      expect(agent.displayName).toBe('Coder')
      expect(agent.role).toBe('executor')
      expect(agent.systemPrompt).toContain('implementation')
    })

    it('returns reviewer with reviewer role', () => {
      const agent = getFixedAgent('reviewer')
      expect(agent.name).toBe('reviewer')
      expect(agent.displayName).toBe('Reviewer')
      expect(agent.role).toBe('reviewer')
      expect(agent.systemPrompt).toContain('code review')
    })

    it('returns tester with executor role', () => {
      const agent = getFixedAgent('tester')
      expect(agent.name).toBe('tester')
      expect(agent.displayName).toBe('Tester')
      expect(agent.role).toBe('executor')
      expect(agent.systemPrompt).toContain('test')
    })
  })

  describe('FIXED_AGENTS', () => {
    it('contains exactly 3 agents', () => {
      expect(Object.keys(FIXED_AGENTS)).toHaveLength(3)
    })

    it('all agents have required fields', () => {
      for (const [, def] of Object.entries(FIXED_AGENTS)) {
        expect(typeof def.name).toBe('string')
        expect(typeof def.displayName).toBe('string')
        expect(typeof def.role).toBe('string')
        expect(typeof def.systemPrompt).toBe('string')
      }
    })

    it('all agents have non-empty system prompts (> 100 chars)', () => {
      for (const [, def] of Object.entries(FIXED_AGENTS)) {
        expect(def.systemPrompt.length).toBeGreaterThan(100)
      }
    })

    it('name matches the record key for all agents', () => {
      for (const [key, def] of Object.entries(FIXED_AGENTS)) {
        expect(def.name).toBe(key as FixedAgentName)
      }
    })
  })

  describe('buildFixedAgentPrompt', () => {
    it('includes cwd, task, and output format fields', () => {
      const agent = getFixedAgent('coder')
      const prompt = buildFixedAgentPrompt(agent, 'Fix the login bug', '')
      expect(prompt).toContain(process.cwd())
      expect(prompt).toContain('Fix the login bug')
      expect(prompt).toContain('"summary"')
      expect(prompt).toContain('"confidence"')
    })

    it('includes the agent system prompt content', () => {
      const agent = getFixedAgent('coder')
      const prompt = buildFixedAgentPrompt(agent, 'task', '')
      expect(prompt).toContain('minimum code')
    })

    it('includes memory context when provided', () => {
      const agent = getFixedAgent('reviewer')
      const prompt = buildFixedAgentPrompt(agent, 'Review this', '## Previous Results\n1. Did X')
      expect(prompt).toContain('Previous Results')
      expect(prompt).toContain('Did X')
    })

    it('omits Memory section when context is empty string', () => {
      const agent = getFixedAgent('tester')
      const prompt = buildFixedAgentPrompt(agent, 'Write tests', '')
      expect(prompt).not.toContain('Memory / Prior Context')
    })

    it('includes all JSON output fields in the template', () => {
      const agent = getFixedAgent('tester')
      const prompt = buildFixedAgentPrompt(agent, 'task', '')
      for (const field of ['summary', 'confidence', 'filesRead', 'filesChanged', 'issuesFound', 'suggestions', 'metadata']) {
        expect(prompt).toContain(`"${field}"`)
      }
    })

    it('works for all three agent definitions', () => {
      const names: FixedAgentName[] = ['coder', 'reviewer', 'tester']
      for (const name of names) {
        const agent = getFixedAgent(name)
        const prompt = buildFixedAgentPrompt(agent, 'do something', '')
        expect(prompt.length).toBeGreaterThan(200)
        expect(prompt).toContain('do something')
      }
    })
  })
})
