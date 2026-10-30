import { describe, it, expect, beforeEach } from 'bun:test'
import {
  getGoal, setGoal, createGoal, updateGoal,
  markGoalComplete, markGoalBlocked, resumeGoal,
  reviseGoal, buildObjectiveRevisionPrompt, buildContinuationPrompt, GOAL_MAX_CONTINUATIONS, getElapsedSeconds,
  recordGoalTurnProgress, GOAL_MAX_IDLE_TURNS, rollbackFailedGoalRevision,
  type Goal,
} from '../src/agent/goal.js'
import { UpdateGoal } from '../src/tools/UpdateGoal/UpdateGoal.js'
import { GetGoal } from '../src/tools/GetGoal/GetGoal.js'

beforeEach(() => {
  setGoal(null)
})

describe('Goal progress', () => {
  it('reports the elapsed time of a running goal', async () => {
    const goal = createGoal('Running')
    setGoal({ ...goal, startedAt: new Date(Date.now() - 30_000).toISOString(), timeUsedSeconds: 5 })
    const result = JSON.parse(await GetGoal.execute({}))
    expect(result.goal.timeUsedSeconds).toBeGreaterThanOrEqual(35)
  })
  it('does not reopen a completed goal through blocked or paused updates', async () => {
    createGoal('Done')
    markGoalComplete()
    for (const status of ['blocked', 'paused']) {
      const result = JSON.parse(await UpdateGoal.execute({ status, blocker: 'waiting' }))
      expect(result.error).toBeTruthy()
      expect(getGoal()?.status).toBe('complete')
    }
  })
  it('does not reactivate a paused goal when a blocker is reported', async () => {
    createGoal('Paused')
    updateGoal({ status: 'paused', updatedAt: new Date().toISOString() })
    const result = JSON.parse(await UpdateGoal.execute({ status: 'blocked', blocker: 'waiting' }))
    expect(result.error).toBeTruthy()
    expect(getGoal()?.status).toBe('paused')
  })
  it('rejects blank blocker descriptions without changing goal state', async () => {
    createGoal('Active')
    for (let i = 0; i < 3; i++) {
      const result = JSON.parse(await UpdateGoal.execute({ status: 'blocked', blocker: '   ' }))
      expect(result.error).toBeTruthy()
    }
    expect(getGoal()).toMatchObject({ status: 'active', consecutiveBlockCount: 0 })
  })
  it('allows ten continuation turns by default', () => {
    expect(GOAL_MAX_CONTINUATIONS).toBe(10)
  })

  it('reports a stall after consecutive turns without file changes and resets on progress', () => {
    createGoal('Ship the feature')
    expect(recordGoalTurnProgress(false)).toBeNull()
    expect(recordGoalTurnProgress(true)).toBeNull()
    for (let turn = 1; turn < GOAL_MAX_IDLE_TURNS; turn++) expect(recordGoalTurnProgress(false)).toBeNull()
    expect(recordGoalTurnProgress(false)).toBe(`no tool calls or file changes in the last ${GOAL_MAX_IDLE_TURNS} goal turns`)
    expect(resumeGoal().idleTurns).toBe(0)
  })
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

describe('Goal objective revisions', () => {
  it('retains elapsed active time when the objective is revised', () => {
    const goal = createGoal('Original')
    setGoal({ ...goal, startedAt: new Date(Date.now() - 30_000).toISOString(), timeUsedSeconds: 5 })
    expect(getElapsedSeconds(reviseGoal('Corrected'))).toBeGreaterThanOrEqual(35)
  })

  it('retains elapsed time when an already active goal is resumed', () => {
    const goal = createGoal('Original')
    setGoal({ ...goal, startedAt: new Date(Date.now() - 30_000).toISOString(), timeUsedSeconds: 5 })
    expect(getElapsedSeconds(resumeGoal())).toBeGreaterThanOrEqual(35)
  })
  it('increments the revision, records the user source, and resets stale completion state', () => {
    createGoal('Original objective', 20_000, 4)
    updateGoal({
      status: 'blocked',
      blockReason: 'Old blocker',
      consecutiveBlockCount: 2,
      idleTurns: 2,
      tokensUsed: 500,
      continuations: 2,
      updatedAt: new Date().toISOString(),
    })
    const first = reviseGoal('  Corrected objective  ')

    expect(first.objective).toBe('Corrected objective')
    expect(first.objectiveRevision).toBe(1)
    expect(first.objectiveSource).toBe('user')
    expect(first.objectiveUpdatedAt).toBeTruthy()
    expect(first.status).toBe('active')
    expect(first.blockReason).toBeUndefined()
    expect(first.consecutiveBlockCount).toBe(0)
    expect(first.idleTurns).toBe(0)
    expect(first.tokensUsed).toBe(500)
    expect(first.continuations).toBe(2)

    const second = reviseGoal('Final objective')
    expect(second.objectiveRevision).toBe(2)
    expect(second.objectiveUpdatedAt).toBeTruthy()
  })

  it('makes the explicit correction authoritative in the replacement prompt', () => {
    const goal = reviseGoalForPrompt()
    const prompt = buildObjectiveRevisionPrompt(goal)
    expect(prompt).toContain('[Objective revision 1 from user]')
    expect(prompt).toContain('Treat the current objective below as authoritative')
    expect(prompt).toContain('Replacement objective')
  })

  it('rejects empty revisions and missing goals', () => {
    expect(() => reviseGoal('  ')).toThrow('The revised objective cannot be empty.')
    setGoal(null)
    expect(() => reviseGoal('Anything')).toThrow('No active goal.')
  })

  it('rolls back a failed checkpoint to the durable goal but preserves a newer revision', () => {
    const durable = structuredClone(createGoal('Durable objective'))
    const failed = reviseGoal('Unpersisted objective')
    expect(rollbackFailedGoalRevision(failed.objectiveRevision!, durable)).toBe(true)
    expect(getGoal()).toEqual(durable)

    const firstFailedRevision = reviseGoal('First correction')
    reviseGoal('Newer correction')
    expect(rollbackFailedGoalRevision(firstFailedRevision.objectiveRevision!, durable)).toBe(false)
    expect(getGoal()?.objective).toBe('Newer correction')
  })
})

function reviseGoalForPrompt(): Goal {
  createGoal('Old objective')
  return reviseGoal('Replacement objective')
}

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

  it('should not return NaN for an active goal with a missing startedAt', () => {
    const goal = createGoal('Legacy goal')
    // Simulate a pre-startedAt persisted goal.
    const legacy = { ...goal, startedAt: '' } as unknown as Goal
    const elapsed = getElapsedSeconds(legacy)
    expect(Number.isNaN(elapsed)).toBe(false)
    expect(elapsed).toBe(legacy.timeUsedSeconds)
  })

  it('should not return NaN for an active goal with an invalid startedAt', () => {
    const goal = createGoal('Corrupt goal')
    const legacy = { ...goal, startedAt: 'not-a-date' } as unknown as Goal
    const elapsed = getElapsedSeconds(legacy)
    expect(Number.isNaN(elapsed)).toBe(false)
    expect(elapsed).toBe(legacy.timeUsedSeconds)
  })

  it('should keep working for valid timestamps', () => {
    const goal = createGoal('Valid goal')
    const past = new Date(Date.now() - 4_000).toISOString()
    updateGoal({ startedAt: past, updatedAt: new Date().toISOString() })
    const elapsed = getElapsedSeconds(getGoal()!)
    expect(elapsed).toBeGreaterThanOrEqual(3)
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

  it('clears the previous session goal when restoring a session without one', () => {
    createGoal('Goal from the previous session')
    setGoal(undefined)
    expect(getGoal()).toBeNull()
  })
})
