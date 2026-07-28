import { Tool } from '../types.js'
import { createGoal, getGoal } from '../../agent/goal.js'

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
        type: 'number',
        description: 'Optional maximum tokens to spend on this goal. When exceeded, status becomes budget_limited.',
      },
    },
    required: ['objective'],
  },
  async execute(args) {
    const objective = (args.objective as string)?.trim()
    if (!objective) return JSON.stringify({ error: 'objective is required.' })

    const existing = getGoal()
    const unfinished = new Set(['active', 'paused', 'blocked', 'budget_limited', 'usage_limited'])
    if (existing && unfinished.has(existing.status)) {
      return JSON.stringify({
        error: 'An unfinished goal already exists. Complete or clear it first.',
        goal: { objective: existing.objective, status: existing.status },
      })
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
