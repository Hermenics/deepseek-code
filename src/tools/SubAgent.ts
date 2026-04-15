import { Tool } from './types.js'
import OpenAI from 'openai'
import { join } from 'path'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'
import type { ProviderConfig } from '../ui/setup/ApiKeySetup.js'
import { createLLMClient, defaultModel } from '../agent/llmClient.js'

// Provider config inherited from the parent Agent
let subAgentProvider: ProviderConfig = { provider: 'deepseek' }

export function setSubAgentProvider(cfg: ProviderConfig) {
  subAgentProvider = cfg
}

function buildSubAgentPrompt(task: string): string {
  const cwd = process.cwd()
  return `You are a specialized subagent of DeepSeek Code, spawned to handle a focused subtask.

## Context
- Working directory: ${cwd}
- You are operating independently with your own context window
- The parent agent has delegated this specific task to you

## Your Task
${task}

## Behavior
1. ANALYZE: Understand exactly what is being asked
2. PLAN: Identify which files/commands you need to read or run first
3. EXECUTE: Carry out the task step by step using the available tools
4. RETURN: Respond with only the result — no preamble, no summary of what you did

## Rules
- Be precise and focused — do only what the task asks
- Read relevant files before making changes
- If the task is ambiguous, make a reasonable assumption and state it briefly
- Return the final result directly`
}

export const SubAgent: Tool = {
  name: 'subagent',
  description: 'Spawn a specialized subagent to handle a focused subtask independently with its own context and access to all tools (filesystem, shell, grep, etc.). Use this to delegate focused subtasks like analyzing a directory, refactoring a file, running tests, or researching something. Multiple subagent calls in the same response are executed in parallel. Returns the subagent\'s final result.',
  parameters: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'The specific task for the subagent. Be precise: include file paths, expected output format, and any constraints.',
      },
      model: {
        type: 'string',
        description: 'Optional model override (e.g. "deepseek-reasoner" for complex reasoning tasks). Defaults to the parent model.',
      },
    },
    required: ['task'],
  },
  async execute(args) {
    const task = args.task as string
    const modelOverride = args.model as string | undefined

    // Lazy import to avoid circular dependency
    const { allTools, toolMap } = await import('./index.js')
    const subagentTools = allTools.filter((t) => t.name !== 'subagent')
    const openaiTools: ChatCompletionTool[] = subagentTools.map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown> },
    }))

    const client = createLLMClient(subAgentProvider)
    const model = modelOverride ?? defaultModel(subAgentProvider.provider)

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: buildSubAgentPrompt(task) },
      { role: 'user', content: task },
    ]

    for (let i = 0; i < 15; i++) {
      const response = await client.chat.completions.create({
        model,
        messages,
        tools: openaiTools,
      })

      const msg = response.choices[0]!.message

      if (!msg.tool_calls?.length) {
        return msg.content ?? '(no output)'
      }

      messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls })

      for (const tc of msg.tool_calls) {
        let parsedArgs: Record<string, unknown> = {}
        try { parsedArgs = JSON.parse(tc.function.arguments) } catch {}

        const tool = toolMap.get(tc.function.name)
        let result: string
        if (tool) {
          try { result = await tool.execute(parsedArgs) } catch (e: unknown) {
            result = `Error: ${(e as Error).message}`
          }
        } else {
          result = `Unknown tool: ${tc.function.name}`
        }

        messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
      }
    }

    return '(subagent reached max iterations)'
  },
}
