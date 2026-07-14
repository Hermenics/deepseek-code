import type { Tool } from '../types.js'

export interface SubmitPlanArgs {
  path: string
  summary?: string
}

export const SubmitPlan: Tool = {
  name: 'submit_plan',
  description: `Signal that you have finished writing the implementation plan to disk.
Call this when your plan file is complete at \`path\`.
This will pause execution and show the plan to the user for approval.
Do NOT call any other tools after this — wait for the user's decision.`,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to the plan markdown file you wrote.' },
      summary: { type: 'string', description: 'One-line summary of what the plan covers (shown in dialog header).' },
    },
    required: ['path'],
  },
  async execute(args) {
    const { path } = args as unknown as SubmitPlanArgs
    return JSON.stringify({ submitted: true, path })
  },
}
