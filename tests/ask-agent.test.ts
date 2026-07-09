import { describe, it, expect } from 'bun:test'
import { AskAgent, setAgentNoteCallback } from '../src/tools/AskAgent/AskAgent.js'

describe('AskAgent tool', () => {
  describe('schema', () => {
    it('has correct name', () => {
      expect(AskAgent.name).toBe('ask_agent')
    })

    it('has a non-empty description', () => {
      expect(typeof AskAgent.description).toBe('string')
      expect(AskAgent.description.length).toBeGreaterThan(0)
    })

    it('requires question parameter', () => {
      const params = AskAgent.parameters as any
      expect(params.required).toContain('question')
    })

    it('has agent enum with exactly 3 specialists', () => {
      const params = AskAgent.parameters as any
      expect(params.properties.agent.enum).toEqual(['coder', 'reviewer', 'tester'])
    })

    it('has broadcast boolean param', () => {
      const params = AskAgent.parameters as any
      expect(params.properties.broadcast.type).toBe('boolean')
    })

    it('question is not in enum (free text)', () => {
      const params = AskAgent.parameters as any
      expect(params.properties.question.type).toBe('string')
      expect(params.properties.question.enum).toBeUndefined()
    })
  })

  describe('execute — invalid inputs', () => {
    it('returns error for invalid agent name', async () => {
      const result = await AskAgent.execute({ question: 'test?', agent: 'invalid' })
      expect(result).toContain('Error')
    })

    it('returns error when agent is omitted and broadcast is false', async () => {
      const result = await AskAgent.execute({ question: 'test?' })
      expect(result).toContain('Error')
    })

    it('returns error when agent is empty string', async () => {
      const result = await AskAgent.execute({ question: 'test?', agent: '' })
      expect(result).toContain('Error')
    })
  })

  describe('execute — single agent dispatch', () => {
    it('returns dispatch confirmation mentioning the agent name', async () => {
      const result = await AskAgent.execute({ question: 'Is this safe?', agent: 'reviewer' })
      expect(result).toContain('@reviewer')
    })

    it('mentions next turn in the response', async () => {
      const result = await AskAgent.execute({ question: 'Is this safe?', agent: 'reviewer' })
      expect(result).toContain('next turn')
    })

    it('works for coder agent', async () => {
      const result = await AskAgent.execute({ question: 'How to fix this?', agent: 'coder' })
      expect(result).toContain('@coder')
    })

    it('works for tester agent', async () => {
      const result = await AskAgent.execute({ question: 'Write tests', agent: 'tester' })
      expect(result).toContain('@tester')
    })

    it('returns almost immediately (fire-and-forget)', async () => {
      const start = Date.now()
      await AskAgent.execute({ question: 'Quick check', agent: 'coder' })
      expect(Date.now() - start).toBeLessThan(100)
    })
  })

  describe('execute — broadcast', () => {
    it('mentions all 3 agents when broadcast=true', async () => {
      const result = await AskAgent.execute({ question: 'Thoughts?', broadcast: true })
      expect(result).toContain('@coder')
      expect(result).toContain('@reviewer')
      expect(result).toContain('@tester')
    })

    it('broadcast ignores agent param and fans out to all', async () => {
      const result = await AskAgent.execute({ question: 'Thoughts?', agent: 'coder', broadcast: true })
      expect(result).toContain('@reviewer')
      expect(result).toContain('@tester')
    })

    it('broadcast returns immediately (fire-and-forget)', async () => {
      const start = Date.now()
      await AskAgent.execute({ question: 'All agents check this', broadcast: true })
      expect(Date.now() - start).toBeLessThan(100)
    })
  })

  describe('setAgentNoteCallback', () => {
    it('is a function', () => {
      expect(typeof setAgentNoteCallback).toBe('function')
    })

    it('accepts a callback without throwing', () => {
      expect(() => setAgentNoteCallback((name, text) => {})).not.toThrow()
    })
  })
})
