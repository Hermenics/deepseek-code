import { Tool } from '../types.js'
import { getGoal, updateGoal, markGoalComplete, markGoalBlocked, resumeGoal } from '../../agent/goal.js'

export const UpdateGoal: Tool = {
  name: 'update_goal',
  description:
    'Update the goal status. Use status=complete when the goal is achieved. ' +
    'Use status=blocked when stuck (requires blocker field, and only after 3+ consecutive occurrences of the same blocker). ' +
    'Use status=paused to temporarily stop. Use status=active to resume.',
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['active', 'paused', 'blocked', 'complete'],
        description:
          'New status. Use active to resume, paused to hold, blocked when stuck (requires blocker), complete when done.',
      },
      blocker: {
        type: 'string',
        description: 'Required when status=blocked. Describe what is blocking progress.',
      },
    },
    required: ['status'],
  },
  async execute(args) {
    const status = args.status as string
    const blocker = args.blocker as string | undefined
    const goal = getGoal()

    if (!goal) return JSON.stringify({ error: 'No active goal.' })

    switch (status) {
      case 'complete': {
        const updated = markGoalComplete()
        return JSON.stringify({
          success: true,
          goal: {
            objective: updated.objective,
            status: updated.status,
            tokensUsed: updated.tokensUsed,
            timeUsedSeconds: updated.timeUsedSeconds,
          },
          remainingTokens:
            updated.tokenBudget !== undefined
              ? Math.max(0, updated.tokenBudget - updated.tokensUsed)
              : null,
        })
      }
      case 'blocked': {
        if (!blocker)
          return JSON.stringify({ error: 'blocker is required when status=blocked.' })
        try {
          const updated = markGoalBlocked(blocker)
          const actuallyBlocked = updated.status === 'blocked'
          return JSON.stringify({
            success: true,
            goal: {
              objective: updated.objective,
              status: updated.status,
              blockReason: updated.blockReason,
              consecutiveBlockCount: updated.consecutiveBlockCount,
            },
            message: actuallyBlocked
              ? 'Goal marked as blocked after 3+ consecutive occurrences.'
              : `Blocker noted (${updated.consecutiveBlockCount}/3). Goal still active.`,
          })
        } catch (e) {
          return JSON.stringify({ error: (e as Error).message })
        }
      }
      case 'paused': {
        const updated = updateGoal({ status: 'paused', updatedAt: new Date().toISOString() })
        return JSON.stringify({
          success: true,
          goal: { objective: updated.objective, status: updated.status },
        })
      }
      case 'active': {
        const updated = resumeGoal()
        return JSON.stringify({
          success: true,
          goal: { objective: updated.objective, status: updated.status },
        })
      }
      default:
        return JSON.stringify({ error: `Unknown status: ${status}` })
    }
  },
}
