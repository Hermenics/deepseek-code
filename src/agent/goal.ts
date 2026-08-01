export type GoalStatus = 'active' | 'paused' | 'blocked' | 'budget_limited' | 'usage_limited' | 'complete'

export interface Goal {
  objective: string
  status: GoalStatus
  tokenBudget?: number
  maxContinuations?: number
  tokensUsed: number
  timeUsedSeconds: number
  consecutiveBlockCount: number
  continuations: number
  blockReason?: string
  createdAt: string
  updatedAt: string
  startedAt: string
}

export const GOAL_MAX_CONTINUATIONS = 3

let currentGoal: Goal | null = null

export function getGoal(): Goal | null {
  return currentGoal
}

export function setGoal(g: Goal | null): void {
  currentGoal = g
}

export function updateGoal(update: Partial<Goal> & { updatedAt: string }): Goal {
  if (!currentGoal) throw new Error('No active goal.')
  // Freeze elapsed time when leaving active state
  if (update.status && update.status !== 'active' && currentGoal.status === 'active') {
    currentGoal.timeUsedSeconds = getElapsedSeconds(currentGoal)
  }
  currentGoal = { ...currentGoal, ...update }
  return currentGoal
}

export function createGoal(objective: string, tokenBudget?: number, maxContinuations?: number): Goal {
  const now = new Date().toISOString()
  const goal: Goal = {
    objective,
    status: 'active',
    tokenBudget,
    maxContinuations,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    consecutiveBlockCount: 0,
    continuations: 0,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
  }
  setGoal(goal)
  return goal
}

export function markGoalComplete(): Goal {
  return updateGoal({ status: 'complete', updatedAt: new Date().toISOString() })
}

export function markGoalBlocked(blocker: string): Goal {
  if (!currentGoal) throw new Error('No active goal.')
  const sameBlocker = currentGoal.blockReason === blocker
  const count = sameBlocker ? currentGoal.consecutiveBlockCount + 1 : 1
  const status = count >= 3 ? 'blocked' : 'active'
  return updateGoal({
    status,
    consecutiveBlockCount: count,
    blockReason: blocker,
    updatedAt: new Date().toISOString(),
  })
}

export function resumeGoal(): Goal {
  if (!currentGoal) throw new Error('No active goal.')
  if (currentGoal.status === 'complete') return currentGoal
  const now = new Date().toISOString()
  return updateGoal({
    status: 'active',
    consecutiveBlockCount: 0,
    blockReason: undefined,
    startedAt: now,
    updatedAt: now,
  })
}

export function getElapsedSeconds(goal: Goal): number {
  if (goal.status === 'active') {
    // Old persisted goals may lack a valid startedAt. Never return NaN: fall
    // back to the stored elapsed time without adding invalid wall-clock time.
    if (!goal.startedAt) return goal.timeUsedSeconds
    const started = Date.parse(goal.startedAt)
    if (Number.isNaN(started)) return goal.timeUsedSeconds
    const elapsed = Math.floor((Date.now() - started) / 1000)
    return goal.timeUsedSeconds + Math.max(0, elapsed)
  }
  return goal.timeUsedSeconds
}

export function buildContinuationPrompt(goal: Goal, turnNumber: number): string {
  const budget = goal.tokenBudget !== undefined ? `${goal.tokenBudget}` : 'no limit'
  const max = goal.maxContinuations ?? GOAL_MAX_CONTINUATIONS
  const used = goal.tokensUsed
  const elapsed = formatElapsed(getElapsedSeconds(goal))
  return [
    `[Goal continuation ${turnNumber}/${max}]`,
    '',
    `Continue working toward the goal:`,
    `"${goal.objective}"`,
    '',
    `${used}/${budget} tokens consumed. ${elapsed} elapsed.`,
    '',
    `When achieved: call update_goal with status "complete".`,
    `If blocked (3+ consecutive same reason): call update_goal with status "blocked" + describe blocker.`,
  ].join('\n')
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}
