import { Tool } from '../types.js'
import { getGoal, updateGoal, markGoalBlocked, resumeGoal } from '../../agent/goal.js'

/** Tool that transitions the current goal between active, paused, blocked and complete. */
export const UpdateGoal: Tool = {
  name: 'update_goal',
  description:
    'Update the goal status. Use status=complete only when the goal is achieved, and include completion_summary with concise evidence that every part is finished; a separate current-model reviewer checks it. ' +
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
      completion_summary: {
        type: 'string',
        maxLength: 2000,
        description: 'Required when status=complete. Explicitly state that the whole goal is done and give concise evidence for every requirement.',
      },
    },
    required: ['status'],
  },
  /** A `blocked` request only takes effect after the same blocker is reported 3 consecutive times; earlier reports just bump the counter and leave the goal active. */
  async execute(args, context) {
    const status = args.status as string
    const blocker = args.blocker as string | undefined
    const goal = getGoal()

    if (!goal) return JSON.stringify({ error: 'No active goal.' })

    switch (status) {
      case 'complete': {
        const completionSummary = args.completion_summary
        if (typeof completionSummary !== 'string' || !completionSummary.trim()) {
          return JSON.stringify({ success: false, error: 'completion_summary is required; the goal remains active.' })
        }
        if (!context?.verifyGoalCompletion) {
          return JSON.stringify({
            success: false,
            error: 'Goal completion requires the separate model reviewer; the goal remains active.',
          })
        }
        return context.verifyGoalCompletion(completionSummary.trim())
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
