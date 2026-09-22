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
  /** Consecutive goal turns without tool calls or file changes. */
  idleTurns?: number
  blockReason?: string
  createdAt: string
  updatedAt: string
  startedAt: string
}

/** Default cap on automatic continuation turns when a goal sets no maxContinuations of its own. */
export const GOAL_MAX_CONTINUATIONS = 10
/** Goal turns in a row without tool calls or file changes before an active goal stops continuing by itself. */
export const GOAL_MAX_IDLE_TURNS = 2

let currentGoal: Goal | null = null

/** Returns the process-wide current goal, or null when none is set. */
export function getGoal(): Goal | null {
  return currentGoal
}

export function setGoal(g: Goal | null): void {
  currentGoal = g
}

/** Merges fields into the current goal, freezing accumulated elapsed time when it leaves the active state. Throws without a goal. */
export function updateGoal(update: Partial<Goal> & { updatedAt: string }): Goal {
  if (!currentGoal) throw new Error('No active goal.')
  // Freeze elapsed time when leaving active state
  if (update.status && update.status !== 'active' && currentGoal.status === 'active') {
    currentGoal.timeUsedSeconds = getElapsedSeconds(currentGoal)
  }
  currentGoal = { ...currentGoal, ...update }
  return currentGoal
}

/** Creates a fresh active goal with zeroed counters and makes it the current goal. */
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

/**
 * Records whether a goal turn did any work. Investigation, verification and reporting all use tools, so
 * only a turn with no tool calls and no file changes counts as idle. Returns a block reason once stalled.
 */
export function recordGoalTurnProgress(worked: boolean): string | null {
  if (!currentGoal) return null
  const idleTurns = worked ? 0 : (currentGoal.idleTurns ?? 0) + 1
  updateGoal({ idleTurns, updatedAt: new Date().toISOString() })
  return idleTurns >= GOAL_MAX_IDLE_TURNS ? `no tool calls or file changes in the last ${idleTurns} goal turns` : null
}

export function markGoalComplete(): Goal {
  return updateGoal({ status: 'complete', updatedAt: new Date().toISOString() })
}

/** Records a blocker; the goal only becomes `blocked` after the same reason is reported three times in a row. */
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

/** Reactivates a non-complete goal, clearing block and idle counters and restarting the elapsed-time clock. */
export function resumeGoal(): Goal {
  if (!currentGoal) throw new Error('No active goal.')
  if (currentGoal.status === 'complete') return currentGoal
  const now = new Date().toISOString()
  return updateGoal({
    status: 'active',
    consecutiveBlockCount: 0,
    idleTurns: 0,
    blockReason: undefined,
    startedAt: now,
    updatedAt: now,
  })
}

/** Returns total working time: stored time plus the running interval while active, tolerating a missing or invalid startedAt. */
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

/** Builds the synthetic user message that drives the next automatic goal turn, including budget and elapsed-time status. */
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
