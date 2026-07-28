import { Tool } from '../types.js'
import { getGoal } from '../../agent/goal.js'

export const GetGoal: Tool = {
  name: 'get_goal',
  description:
    'Read the current goal and its status. Returns the objective, status (active/paused/blocked/complete/etc), tokens used, token budget (if set), time elapsed, and whether the goal is blocked.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  async execute() {
    const goal = getGoal()
    if (!goal) return JSON.stringify({ error: 'No active goal.', goal: null })
    return JSON.stringify({
      goal: {
        objective: goal.objective,
        status: goal.status,
        tokenBudget: goal.tokenBudget ?? null,
        tokensUsed: goal.tokensUsed,
        timeUsedSeconds: goal.timeUsedSeconds,
        remainingTokens:
          goal.tokenBudget !== undefined ? Math.max(0, goal.tokenBudget - goal.tokensUsed) : null,
        blockReason: goal.blockReason ?? null,
        continuations: goal.continuations,
      },
    })
  },
}
