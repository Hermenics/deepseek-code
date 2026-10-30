import { Tool } from '../types.js'
import { formatToolError } from '../result.js'
import { createGoal, getGoal } from '../../agent/goal.js'

/** Tool that starts a session goal with an optional token budget; refuses while an unfinished (active, paused, blocked or limited) goal exists. */
export const CreateGoal: Tool = {
  name: 'create_goal',
  description:
    'Set a new goal for the session. The model should then work toward this goal across multiple turns. If you know the objective is large, set a tokenBudget to limit resource usage. Fails if there is already an active unfinished goal.',
  parameters: {
    type: 'object',
    properties: {
      objective: {
        type: 'string',
        description: 'The goal to achieve. Be specific and measurable.',
      },
      tokenBudget: {
        type: 'integer',
        minimum: 1,
        description: 'Optional maximum tokens to spend on this goal. When exceeded, status becomes budget_limited.',
      },
    },
    required: ['objective'],
  },
  async execute(args) {
    const objective = typeof args.objective === 'string' ? args.objective.trim() : ''
    if (!objective) return formatToolError('validation', 'INVALID_ARGUMENTS', 'objective is required.')
    if (args.tokenBudget !== undefined && (!Number.isSafeInteger(args.tokenBudget) || (args.tokenBudget as number) < 1)) {
      return formatToolError('validation', 'INVALID_ARGUMENTS', 'tokenBudget must be a positive safe integer.')
    }

    const existing = getGoal()
    const unfinished = new Set(['active', 'paused', 'blocked', 'budget_limited', 'usage_limited'])
    if (existing && unfinished.has(existing.status)) {
      return formatToolError('conflict', 'GOAL_ALREADY_EXISTS', `An unfinished ${existing.status} goal already exists: ${JSON.stringify({ objective: existing.objective })}. Complete or clear it first.`)
    }

    const tokenBudget = args.tokenBudget as number | undefined
    const goal = createGoal(objective, tokenBudget)
    return JSON.stringify({
      success: true,
      goal: {
        objective: goal.objective,
        status: goal.status,
        tokenBudget: goal.tokenBudget ?? null,
        tokensUsed: goal.tokensUsed,
      },
    })
  },
}
