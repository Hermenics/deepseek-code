import { randomUUID } from 'node:crypto'
import type { ProxyRequest, ChatMessage } from '../types/index.js'
import { getAvailableModels } from '../services/model-resolver.js'
import { injectToolPrompt, parseToolResponse, type ToolDef } from '../tools/prompt-emulation.js'

export function parseRequest(body: any): ProxyRequest {
  let messages: ChatMessage[] = (body.messages || []).map((m: any) => ({
    role: m.role,
    content: typeof m.content === 'string'
      ? m.content
      : Array.isArray(m.content)
        ? m.content.map((b: any) => b.text || b.content || '').join('')
        : m.content === null ? '' : String(m.content),
    ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
  }))

  const tools: ToolDef[] = (body.tools || body.functions || []).map((t: any) => ({
    name: t.function?.name || t.name,
    description: t.function?.description || t.description,
    input_schema: t.function?.parameters || t.input_schema,
  }))

  if (tools.length > 0) {
    messages = injectToolPrompt(messages, tools)
  }

  return {
    model: body.model,
    messages,
    stream: body.stream ?? false,
    conversationId: body.user,
    tools,
  }
}

export function formatStreamChunk(token: string, model: string): string {
  const chunk = {
    id: `chatcmpl-${randomUUID()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: { content: token }, finish_reason: null }],
  }
  return `data: ${JSON.stringify(chunk)}\n\n`
}

export function formatStreamReasoning(reasoning: string, model: string): string {
  const chunk = {
    id: `chatcmpl-${randomUUID()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: { reasoning_content: reasoning }, finish_reason: null }],
  }
  return `data: ${JSON.stringify(chunk)}\n\n`
}

export function parseToolCall(content: string) {
  return parseToolResponse(content)
}

export function formatStreamEnd(): string {
  return 'data: [DONE]\n\n'
}

export function formatStreamToolCall(toolCall: { name: string; id: string; arguments: any }, model: string): string {
  const chunk = {
    id: `chatcmpl-${randomUUID()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      delta: {
        tool_calls: [{
          index: 0,
          id: toolCall.id,
          type: 'function',
          function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) },
        }],
      },
      finish_reason: 'tool_calls',
    }],
  }
  return `data: ${JSON.stringify(chunk)}\n\n`
}

export function formatResponse(model: string, content: string, thinking?: string) {
  const toolCall = parseToolResponse(content)
  if (toolCall) {
    return {
      id: `chatcmpl-${randomUUID()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: toolCall.id,
            type: 'function',
            function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) },
          }],
          ...(thinking ? { reasoning_content: thinking } : {}),
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }
  }

  return {
    id: `chatcmpl-${randomUUID()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content,
        ...(thinking ? { reasoning_content: thinking } : {}),
      },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  }
}

export function formatModelList() {
  return { object: 'list', data: getAvailableModels() }
}
