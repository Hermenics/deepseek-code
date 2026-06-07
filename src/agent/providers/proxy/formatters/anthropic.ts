import { randomUUID } from 'node:crypto'
import type { ProxyRequest, ChatMessage } from '../types/index.js'
import { injectToolPrompt, parseToolResponse, type ToolDef } from '../tools/prompt-emulation.js'

export function parseRequest(body: any): ProxyRequest & { tools?: ToolDef[] } {
  let messages: ChatMessage[] = (body.messages || []).map((m: any) => ({
    role: m.role,
    content: typeof m.content === 'string'
      ? m.content
      : Array.isArray(m.content)
        ? m.content.map((b: any) => b.text || '').join('')
        : String(m.content),
  }))

  const tools: ToolDef[] = body.tools?.map((t: any) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  })) || []

  if (tools.length > 0) {
    messages = injectToolPrompt(messages, tools)
  }

  return {
    model: body.model,
    messages,
    stream: body.stream ?? false,
    tools,
  }
}

export function formatStreamStart(model: string): string {
  const msgStart = { type: 'message_start', message: { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null } }
  return `event: message_start\ndata: ${JSON.stringify(msgStart)}\n\n`
}

export function formatThinkingBlock(thinking: string): string {
  const blockStart = { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }
  const delta = { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking } }
  const blockStop = { type: 'content_block_stop', index: 0 }
  return `event: content_block_start\ndata: ${JSON.stringify(blockStart)}\n\nevent: content_block_delta\ndata: ${JSON.stringify(delta)}\n\nevent: content_block_stop\ndata: ${JSON.stringify(blockStop)}\n\n`
}

export function formatContentBlockStart(index: number): string {
  const blockStart = { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }
  return `event: content_block_start\ndata: ${JSON.stringify(blockStart)}\n\n`
}

export function formatStreamChunk(token: string, index = 1): string {
  const delta = { type: 'content_block_delta', index, delta: { type: 'text_delta', text: token } }
  return `event: content_block_delta\ndata: ${JSON.stringify(delta)}\n\n`
}

export function formatStreamEnd(index = 0, stopReason = 'end_turn'): string {
  const blockStop = { type: 'content_block_stop', index }
  const msgDelta = { type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 0 } }
  const msgStop = { type: 'message_stop' }
  return `event: content_block_stop\ndata: ${JSON.stringify(blockStop)}\n\nevent: message_delta\ndata: ${JSON.stringify(msgDelta)}\n\nevent: message_stop\ndata: ${JSON.stringify(msgStop)}\n\n`
}

export function formatToolUseBlockStart(index: number, id: string, name: string): string {
  const blockStart = { type: 'content_block_start', index, content_block: { type: 'tool_use', id, name, input: {} } }
  return `event: content_block_start\ndata: ${JSON.stringify(blockStart)}\n\n`
}

export function formatToolUseBlockDelta(index: number, argsJson: string): string {
  const delta = { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: argsJson } }
  return `event: content_block_delta\ndata: ${JSON.stringify(delta)}\n\n`
}

export function formatToolUseBlockStop(index: number): string {
  const blockStop = { type: 'content_block_stop', index }
  return `event: content_block_stop\ndata: ${JSON.stringify(blockStop)}\n\n`
}

export function formatMessageDelta(stopReason: string): string {
  const msgDelta = { type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 0 } }
  return `event: message_delta\ndata: ${JSON.stringify(msgDelta)}\n\n`
}

export function formatResponse(model: string, content: string, thinking?: string) {
  const toolCall = parseToolResponse(content)
  if (toolCall) {
    return {
      id: `msg_${randomUUID()}`,
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'tool_use', id: toolCall.id, name: toolCall.name, input: toolCall.arguments }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 0, output_tokens: 0 },
    }
  }

  const contentBlocks: any[] = []
  if (thinking) contentBlocks.push({ type: 'thinking', thinking })
  contentBlocks.push({ type: 'text', text: content })

  return {
    id: `msg_${randomUUID()}`,
    type: 'message',
    role: 'assistant',
    model,
    content: contentBlocks,
    stop_reason: 'end_turn',
    usage: { input_tokens: 0, output_tokens: 0 },
  }
}
