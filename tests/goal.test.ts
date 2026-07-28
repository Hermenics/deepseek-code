import { describe, it, expect, beforeEach } from 'bun:test'
import {
  getGoal, setGoal, createGoal, updateGoal,
  markGoalComplete, markGoalBlocked, resumeGoal,
  buildContinuationPrompt, GOAL_MAX_CONTINUATIONS,
} from '../src/agent/goal.js'

beforeEach(() => {
  setGoal(null)
})

describe('Goal creation', () => {
  it('should create a goal with default status active', () => {
    const goal = createGoal('Implement login', 10000)
    expect(goal.objective).toBe('Implement login')
    expect(goal.status).toBe('active')
    expect(goal.tokenBudget).toBe(10000)
    expect(goal.tokensUsed).toBe(0)
    expect(goal.consecutiveBlockCount).toBe(0)
    expect(goal.continuations).toBe(0)
  })

  it('should set createdAt and updatedAt', () => {
    const goal = createGoal('Test')
    expect(goal.createdAt).toBeTruthy()
    expect(goal.updatedAt).toBe(goal.createdAt)
  })

  it('should retrieve the same goal via getGoal', () => {
    const created = createGoal('Test')
    const retrieved = getGoal()
    expect(retrieved).not.toBeNull()
    expect(retrieved!.objective).toBe(created.objective)
  })

  it('should return null getGoal when no goal set', () => {
    expect(getGoal()).toBeNull()
  })
})

describe('Status transitions', () => {
  it('should mark goal complete', () => {
    createGoal('Something')
    const completed = markGoalComplete()
    expect(completed.status).toBe('complete')
  })

  it('should resume a paused goal and reset counters', () => {
    createGoal('Something')
    updateGoal({ status: 'paused', updatedAt: new Date().toISOString() })
    const resumed = resumeGoal()
    expect(resumed.status).toBe('active')
    expect(resumed.consecutiveBlockCount).toBe(0)
    expect(resumed.blockReason).toBeUndefined()
  })

  it('should throw markGoalComplete when no active goal', () => {
    expect(() => markGoalComplete()).toThrow('No active goal.')
  })

  it('should throw resumeGoal when no active goal', () => {
    expect(() => resumeGoal()).toThrow('No active goal.')
  })
})

describe('Blocked audit', () => {
  it('should stay active after 1 blocker', () => {
    createGoal('Fix bug')
    const result = markGoalBlocked('API key missing')
    expect(result.status).toBe('active')
    expect(result.consecutiveBlockCount).toBe(1)
    expect(result.blockReason).toBe('API key missing')
  })

  it('should stay active after 2 same blockers', () => {
    createGoal('Fix bug')
    markGoalBlocked('API key missing')
    const result = markGoalBlocked('API key missing')
    expect(result.status).toBe('active')
    expect(result.consecutiveBlockCount).toBe(2)
  })

  it('should mark blocked after 3 same blockers', () => {
    createGoal('Fix bug')
    markGoalBlocked('API key missing')
    markGoalBlocked('API key missing')
    const result = markGoalBlocked('API key missing')
    expect(result.status).toBe('blocked')
    expect(result.consecutiveBlockCount).toBe(3)
  })

  it('should reset counter on new blocker', () => {
    createGoal('Fix bug')
    markGoalBlocked('API key missing')
    markGoalBlocked('API key missing')
    const result = markGoalBlocked('Different blocker')
    expect(result.consecutiveBlockCount).toBe(1)
    expect(result.status).toBe('active')
  })

  it('should throw markGoalBlocked when no active goal', () => {
    expect(() => markGoalBlocked('reason')).toThrow('No active goal.')
  })
})

describe('updateGoal', () => {
  it('should partially update goal fields', () => {
    const goal = createGoal('Refactor')
    const updated = updateGoal({ tokensUsed: 500, status: 'paused', updatedAt: new Date().toISOString() })
    expect(updated.tokensUsed).toBe(500)
    expect(updated.status).toBe('paused')
    expect(updated.objective).toBe('Refactor') // unchanged
  })

  it('should throw when no active goal', () => {
    expect(() => updateGoal({ updatedAt: new Date().toISOString() })).toThrow('No active goal.')
  })
})

describe('Continuation prompt', () => {
  it('should include objective and token info', () => {
    const goal = createGoal('Refactor database layer', 50000)
    goal.tokensUsed = 12345
    goal.timeUsedSeconds = 300
    const prompt = buildContinuationPrompt(goal, 3)
    expect(prompt).toContain(`Goal continuation 3/${GOAL_MAX_CONTINUATIONS}`)
    expect(prompt).toContain('Refactor database layer')
    expect(prompt).toContain('12345')
    expect(prompt).toContain('50000')
    expect(prompt).toContain('5m')
  })

  it('should show no limit when no tokenBudget', () => {
    const goal = createGoal('Simple task')
    const prompt = buildContinuationPrompt(goal, 1)
    expect(prompt).toContain('no limit')
  })

  it('should format elapsed time correctly', () => {
    const goal = createGoal('Time formatting', 1000)
    goal.timeUsedSeconds = 3661
    const prompt = buildContinuationPrompt(goal, 1)
    expect(prompt).toContain('1h 1m')
  })

  it('should include update_goal instructions', () => {
    const goal = createGoal('Test')
    const prompt = buildContinuationPrompt(goal, 1)
    expect(prompt).toContain('update_goal')
    expect(prompt).toContain('blocked')
  })
})
