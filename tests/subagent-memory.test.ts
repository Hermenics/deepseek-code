import { describe, it, expect, beforeEach } from 'bun:test'
import {
  getCurrentMemory,
  resetMemory,
  addPreviousResult,
  formatMemoryForPrompt,
  type TaskMemory,
} from '../src/tools/SubAgent/memory.js'

describe('SubAgent memory', () => {
  beforeEach(() => {
    resetMemory()
  })

  describe('getCurrentMemory', () => {
    it('returns a TaskMemory with empty previousResults initially', () => {
      const mem = getCurrentMemory()
      expect(mem).toHaveProperty('previousResults')
      expect(mem.previousResults).toEqual([])
    })

    it('returns the same singleton reference across calls', () => {
      const a = getCurrentMemory()
      const b = getCurrentMemory()
      expect(a).toBe(b)
    })
  })

  describe('resetMemory', () => {
    it('creates a fresh instance discarding old data', () => {
      const old = getCurrentMemory()
      addPreviousResult(old, 'task1', 'done', 0.9)
      resetMemory()
      const fresh = getCurrentMemory()
      expect(fresh.previousResults).toEqual([])
      expect(fresh).not.toBe(old)
    })
  })

  describe('addPreviousResult', () => {
    it('stores task, summary, and confidence', () => {
      const mem = getCurrentMemory()
      addPreviousResult(mem, 'analyze code', 'found 3 issues', 0.85)
      expect(mem.previousResults).toHaveLength(1)
      expect(mem.previousResults[0]).toEqual({
        task: 'analyze code',
        summary: 'found 3 issues',
        confidence: 0.85,
      })
    })

    it('appends multiple results in order', () => {
      const mem = getCurrentMemory()
      addPreviousResult(mem, 'task1', 'sum1', 0.5)
      addPreviousResult(mem, 'task2', 'sum2', 0.7)
      addPreviousResult(mem, 'task3', 'sum3', 0.9)
      expect(mem.previousResults).toHaveLength(3)
      expect(mem.previousResults[2].task).toBe('task3')
    })

    it('truncates task to 200 chars', () => {
      const mem = getCurrentMemory()
      const longTask = 'x'.repeat(300)
      addPreviousResult(mem, longTask, 'ok', 1)
      expect(mem.previousResults[0].task).toHaveLength(200)
    })

    it('truncates summary to 300 chars', () => {
      const mem = getCurrentMemory()
      const longSummary = 'y'.repeat(500)
      addPreviousResult(mem, 'task', longSummary, 1)
      expect(mem.previousResults[0].summary).toHaveLength(300)
    })
  })

  describe('formatMemoryForPrompt', () => {
    it('returns empty string when no results exist', () => {
      const mem = getCurrentMemory()
      expect(formatMemoryForPrompt(mem)).toBe('')
    })

    it('includes task and summary in output', () => {
      const mem = getCurrentMemory()
      addPreviousResult(mem, 'read files', 'found config', 0.95)
      const output = formatMemoryForPrompt(mem)
      expect(output).toContain('read files')
      expect(output).toContain('found config')
      expect(output).toContain('95%')
    })

    it('includes section header', () => {
      const mem = getCurrentMemory()
      addPreviousResult(mem, 't', 's', 0.5)
      const output = formatMemoryForPrompt(mem)
      expect(output).toContain('## Previous Subagent Results')
    })

    it('formats multiple results with numbered entries', () => {
      const mem = getCurrentMemory()
      addPreviousResult(mem, 'task1', 'sum1', 0.1)
      addPreviousResult(mem, 'task2', 'sum2', 0.2)
      const output = formatMemoryForPrompt(mem)
      expect(output).toContain('1.')
      expect(output).toContain('2.')
    })

    it('renders all results even beyond 5 (no built-in limit)', () => {
      const mem = getCurrentMemory()
      for (let i = 0; i < 7; i++) {
        addPreviousResult(mem, `task${i}`, `sum${i}`, 0.5)
      }
      const output = formatMemoryForPrompt(mem)
      expect(output).toContain('7.')
      expect(output).toContain('task6')
    })
  })
})
