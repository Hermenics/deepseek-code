import { Tool } from '../types.js'
import OpenAI from 'openai'
import { join } from 'path'
import { randomUUID } from 'node:crypto'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'
import type { ProviderConfig } from '../../types/provider.js'
import { createLLMClient, defaultModel } from '../../agent/llmClient.js'
import { SUBAGENT_MAX_ITERATIONS } from '../../constants.js'
import { resolvePermission } from '../../permissions/matcher.js'
import { loadMergedSettings } from '../../settings/loader.js'

// Provider config and model inherited from the parent Agent
let subAgentProvider: ProviderConfig = { provider: 'deepseek' }
let subAgentModel: string | null = null

export function setSubAgentProvider(cfg: ProviderConfig) {
  subAgentProvider = cfg
}

export function setSubAgentModel(model: string) {
  subAgentModel = model
}

export interface SubAgentCallbacks {
  onStart(id: string, task: string): void
  onToolUse(id: string, tool: string, info?: string): void
  onDone(id: string, result: string, tokens?: number, costUsd?: number): void
  onError(id: string, error: string): void
}

// Cost per million tokens (input+output averaged) by model prefix
const COST_PER_M_TOKENS: Record<string, number> = {
  'deepseek-chat': 0.27,
  'deepseek-reasoner': 0.55,
  'deepseek-v4': 0.27,
  'gpt-4o': 7.5,
  'gpt-4': 30.0,
  'gpt-3.5': 0.75,
  'claude-opus': 45.0,
  'claude-sonnet': 9.0,
  'claude-haiku': 0.75,
}

function estimateCost(model: string, totalTokens: number): number {
  const key = Object.keys(COST_PER_M_TOKENS).find(k => model.startsWith(k))
  const rate = key ? COST_PER_M_TOKENS[key]! : 1.0 // fallback $1/M
  return (totalTokens / 1_000_000) * rate
}

let subAgentCallbacks: SubAgentCallbacks | null = null

export function setSubAgentCallbacks(cb: SubAgentCallbacks | null) {
  subAgentCallbacks = cb
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

function buildToolPreview(toolName: string, args: Record<string, unknown>): string {
  // Extract the most meaningful field per tool instead of dumping raw JSON
  const str = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))
  const truncate = (s: string, n = 50) => s.length > n ? s.slice(0, n) + '…' : s

  switch (toolName) {
    case 'read_file':
    case 'write_file':
    case 'patch_file':
    case 'read_folder':
      return truncate(str(args.path ?? args.file ?? ''))
    case 'shell':
      return truncate(str(args.command ?? ''))
    case 'grep':
      return truncate(`${args.pattern ?? ''} in ${args.path ?? '.'}`)
    case 'glob':
      return truncate(str(args.pattern ?? ''))
    case 'web_fetch':
      return truncate(str(args.url ?? ''))
    case 'subagent': {
      const task = str(args.task ?? '')
      const firstLine = task.split('\n').map((l: string) => l.replace(/^#+\s*/, '').trim()).find((l: string) => l.length > 0) ?? task
      return truncate(firstLine)
    }
    default: {
      // Generic: show first string value found, or nothing
      const first = Object.values(args).find(v => typeof v === 'string') as string | undefined
      return first ? truncate(first) : ''
    }
  }
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
    const agentId = randomUUID().slice(0, 8)

    subAgentCallbacks?.onStart(agentId, task)

    try {
      // Lazy import to avoid circular dependency
      const { allTools, toolMap } = await import('../index.js')
      const subagentTools = allTools.filter((t) => t.name !== 'subagent')
      const openaiTools: ChatCompletionTool[] = subagentTools.map((t) => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown> },
      }))

      const client = createLLMClient(subAgentProvider)
      const model = modelOverride ?? subAgentModel ?? defaultModel(subAgentProvider.provider)

      const messages: ChatCompletionMessageParam[] = [
        { role: 'system', content: buildSubAgentPrompt(task) },
        { role: 'user', content: task },
      ]

      let totalTokens = 0

      for (let i = 0; i < SUBAGENT_MAX_ITERATIONS; i++) {
        const response = await client.chat.completions.create({
          model,
          messages,
          tools: openaiTools,
        })

        if (response.usage?.total_tokens) {
          totalTokens += response.usage.total_tokens
        }

        const msg = response.choices[0]!.message

        if (!msg.tool_calls?.length) {
          const result = msg.content ?? '(no output)'
          const cost = totalTokens > 0 ? estimateCost(model, totalTokens) : undefined
          subAgentCallbacks?.onDone(agentId, result.slice(0, 200), totalTokens || undefined, cost)
          return result
        }

        const assistantMsg: ChatCompletionMessageParam & { reasoning_content?: string } = {
          role: 'assistant',
          content: msg.content ?? null,
          tool_calls: msg.tool_calls,
        }
        const msgReasoning = (msg as unknown as Record<string, unknown>).reasoning_content
        if (typeof msgReasoning === 'string' && msgReasoning) {
          assistantMsg.reasoning_content = msgReasoning
        }
        messages.push(assistantMsg)

        const settings = await loadMergedSettings()

        for (const tc of msg.tool_calls) {
          let parsedArgs: Record<string, unknown> = {}
          const fn = 'function' in tc ? tc.function : undefined
          if (!fn) continue
          try { parsedArgs = JSON.parse(fn.arguments) } catch {}

          subAgentCallbacks?.onToolUse(agentId, fn.name, buildToolPreview(fn.name, parsedArgs))

          const permDecision = resolvePermission(settings.permissions, fn.name, parsedArgs)
          if (permDecision === 'deny') {
            messages.push({ role: 'tool', tool_call_id: tc.id, content: `Tool '${fn.name}' blocked by permission rule.` })
            continue
          }

          const tool = toolMap.get(fn.name)
          let result: string
          if (tool) {
            try { result = await tool.execute(parsedArgs) } catch (e: unknown) {
              result = `Error: ${(e as Error).message}`
            }
          } else {
            result = `Unknown tool: ${fn.name}`
          }

          messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
        }
      }

      const maxResult = '(subagent reached max iterations)'
      const cost = totalTokens > 0 ? estimateCost(model, totalTokens) : undefined
      subAgentCallbacks?.onDone(agentId, maxResult, totalTokens || undefined, cost)
      return maxResult
    } catch (e: unknown) {
      const errMsg = (e as Error).message ?? String(e)
      subAgentCallbacks?.onError(agentId, errMsg)
      throw e
    }
  },
}
