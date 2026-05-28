export interface ToolCall {
  id: string
  name: string
  arguments: string
}

export interface ToolResult {
  toolCallId: string
  content: string
  isError?: boolean
}

export interface Message {
  role: 'user' | 'assistant' | 'tool' | 'terminal' | 'thinking'
  content: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  timestamp?: number
}
