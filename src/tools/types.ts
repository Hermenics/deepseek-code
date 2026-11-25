import type { ToolExecutionContext } from '../orchestration/types.js'

/** Optional slice of the Agent callback contract used for live tool progress. */
export interface ToolCallbacks {
  onToolCall?(name: string, args: object): void
}

export interface Tool {
  name: string
  description: string
  parameters: object
  /** Server identity for host-managed MCP catalog validation. */
  mcpServerName?: string
  execute(args: Record<string, unknown>, context?: ToolExecutionContext, callbacks?: ToolCallbacks): Promise<string>
}
