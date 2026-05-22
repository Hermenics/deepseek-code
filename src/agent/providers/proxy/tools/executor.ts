import { getTool } from './registry.js'

export interface ParsedToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolCallResult {
  toolCallId: string
  name: string
  result: string
  isError: boolean
}

export async function executeToolCalls(
  toolCalls: ParsedToolCall[]
): Promise<ToolCallResult[]> {
  return Promise.all(
    toolCalls.map(async (toolCall) => {
      const tool = getTool(toolCall.name)

      if (!tool) {
        return {
          toolCallId: toolCall.id,
          name: toolCall.name,
          result: `Tool not found: ${toolCall.name}`,
          isError: true,
        }
      }

      try {
        const result = await tool.execute(toolCall.arguments)
        return {
          toolCallId: toolCall.id,
          name: toolCall.name,
          result,
          isError: false,
        }
      } catch (error: unknown) {
        return {
          toolCallId: toolCall.id,
          name: toolCall.name,
          result: error instanceof Error ? error.message : String(error),
          isError: true,
        }
      }
    })
  )
}
