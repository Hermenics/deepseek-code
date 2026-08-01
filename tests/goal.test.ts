import { describe, it, expect, beforeEach } from 'bun:test'
import {
  getGoal, setGoal, createGoal, updateGoal,
  markGoalComplete, markGoalBlocked, resumeGoal,
  buildContinuationPrompt, GOAL_MAX_CONTINUATIONS, getElapsedSeconds,
  type Goal,
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

  it('should set createdAt, updatedAt, and startedAt', () => {
    const goal = createGoal('Test')
    expect(goal.createdAt).toBeTruthy()
    expect(goal.updatedAt).toBe(goal.createdAt)
    expect(goal.startedAt).toBe(goal.createdAt)
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

describe('Time accounting', () => {
  it('should set startedAt on creation', () => {
    const goal = createGoal('Timed task')
    expect(goal.startedAt).toBeTruthy()
    expect(goal.timeUsedSeconds).toBe(0)
  })

  it('should compute elapsed seconds for active goals', () => {
    const goal = createGoal('Timed task')
    // Set startedAt 10 seconds in the past
    const past = new Date(Date.now() - 10_000).toISOString()
    updateGoal({ startedAt: past, updatedAt: new Date().toISOString() })
    const elapsed = getElapsedSeconds(getGoal()!)
    expect(elapsed).toBeGreaterThanOrEqual(9) // allow 1s tolerance
    expect(elapsed).toBeLessThanOrEqual(15)
  })

  it('should freeze timeUsedSeconds when leaving active state', () => {
    const goal = createGoal('Pause test')
    const past = new Date(Date.now() - 5_000).toISOString()
    updateGoal({ startedAt: past, updatedAt: new Date().toISOString() })

    // Pause the goal — should freeze elapsed time
    updateGoal({ status: 'paused', updatedAt: new Date().toISOString() })
    const frozen = getGoal()!
    expect(frozen.timeUsedSeconds).toBeGreaterThan(0)

    // Elapsed should not increase after pausing (uses stored value)
    const after = getElapsedSeconds(frozen)
    expect(after).toBe(frozen.timeUsedSeconds)
  })

  it('should reset startedAt on resume', () => {
    createGoal('Resume test')
    updateGoal({ status: 'paused', timeUsedSeconds: 30, updatedAt: new Date().toISOString() })
    const resumed = resumeGoal()
    expect(resumed.startedAt).toBeTruthy()
    expect(new Date(resumed.startedAt).getTime()).toBeGreaterThanOrEqual(Date.now() - 1000)
  })

  it('should include startedAt in serialization round-trip', () => {
    const goal = createGoal('Serialize test')
    const serialized = JSON.stringify(goal)
    const parsed = JSON.parse(serialized) as Goal
    expect(parsed.startedAt).toBe(goal.startedAt)
  })
})

describe('Goal persistence round-trip', () => {
  it('should survive JSON serialization and deserialization', () => {
    const goal = createGoal('Implement authentication', 100000, 5)
    updateGoal({ tokensUsed: 500, continuations: 2, updatedAt: new Date().toISOString() })

    // Simulate session save/load cycle
    const serialized = JSON.stringify(getGoal())
    const parsed = JSON.parse(serialized) as Goal

    expect(parsed.objective).toBe('Implement authentication')
    expect(parsed.status).toBe('active')
    expect(parsed.tokenBudget).toBe(100000)
    expect(parsed.maxContinuations).toBe(5)
    expect(parsed.tokensUsed).toBe(500)
    expect(parsed.continuations).toBe(2)
    expect(parsed.createdAt).toBeTruthy()
    expect(parsed.updatedAt).toBeTruthy()
  })

  it('should restore goal state from saved JSON', () => {
    createGoal('Refactor DB', 50000)
    markGoalBlocked('API key missing')

    const saved = JSON.stringify(getGoal())
    setGoal(null)
    expect(getGoal()).toBeNull()

    const restored = JSON.parse(saved) as Goal
    setGoal(restored)
    expect(getGoal()!.objective).toBe('Refactor DB')
    expect(getGoal()!.status).toBe('active')
    expect(getGoal()!.consecutiveBlockCount).toBe(1)
  })

  it('should handle null goal in session data', () => {
    setGoal(null)
    const sessionData = { goal: getGoal() ?? undefined }
    expect(sessionData.goal).toBeUndefined()
  })
})
