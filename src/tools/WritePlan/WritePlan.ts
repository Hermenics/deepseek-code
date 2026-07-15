import type { Tool } from '../types.js'
import * as fs from 'fs/promises'
import { dirname } from 'path'

export const WritePlan: Tool = {
  name: 'write_plan',
  description: `Write or update the plan markdown file. Only available in plan mode.
The file path is managed internally — you only need to provide the content.`,
  parameters: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'Full markdown content for the plan file.' },
    },
    required: ['content'],
  },
  async execute(args) {
    const planPath = args.__planFilePath as string | undefined
    if (!planPath) {
      return 'Error: No plan file path set. Are you in plan mode?'
    }

    const content = args.content as string
    await fs.mkdir(dirname(planPath), { recursive: true })
    await fs.writeFile(planPath, content, 'utf-8')
    return `Plan written to ${planPath}`
  },
}
