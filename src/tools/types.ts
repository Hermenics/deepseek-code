import type { ToolExecutionContext } from '../orchestration/types.js'

export interface Tool {
  name: string
  description: string
  parameters: object
  execute(args: Record<string, unknown>, context?: ToolExecutionContext): Promise<string>
}
