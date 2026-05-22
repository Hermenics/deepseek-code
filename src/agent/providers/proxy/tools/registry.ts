import type { JsonSchema } from './types.js'

export interface ToolDefinition {
  name: string
  description: string
  parameters: JsonSchema
  execute: (args: Record<string, unknown>) => Promise<string>
}

const tools = new Map<string, ToolDefinition>()

export function registerTool(tool: ToolDefinition): void {
  tools.set(tool.name, tool)
}

export function getTool(name: string): ToolDefinition | undefined {
  return tools.get(name)
}

export function getAllTools(): ToolDefinition[] {
  return Array.from(tools.values())
}

export function clearTools(): void {
  tools.clear()
}
