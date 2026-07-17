import type { Tool } from '../types.js'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'
import type { ProviderConfig } from '../../types/provider.js'
import { createLLMClient } from '../../agent/llmClient.js'
import { SUBAGENT_MAX_ITERATIONS } from '../../constants.js'
import { resolvePermission } from '../../permissions/matcher.js'
import { assessRisk } from '../../permissions/risk.js'
import { loadMergedSettings } from '../../settings/loader.js'
import type { AgentPermissionConfig } from '../../agent/config.js'

export interface ExecutorCallbacks {
  onToolUse?(id: string, tool: string, info?: string): void
  permissionPolicy?: 'inherit' | 'isolated'
  permissions?: AgentPermissionConfig
}

export function buildToolPreview(toolName: string, args: Record<string, unknown>): string {
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

/**
 * Internal function to run a subagent loop with given prompt, tools, and model.
 * Used by both the main subagent and the verifier.
 */
export async function runSubAgentLoop(
  prompt: string,
  task: string,
  agentId: string,
  filteredTools: Tool[],
  provider: ProviderConfig,
  modelName: string,
  callbacks?: ExecutorCallbacks,
): Promise<{ resultText: string; totalTokens: number }> {
  const subagentToolMap = new Map(filteredTools.map((t) => [t.name, t]))
  const openaiTools: ChatCompletionTool[] = filteredTools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown> },
  }))

  const client = createLLMClient(provider)

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: prompt },
    { role: 'user', content: task },
  ]

  let totalTokens = 0
  let subAgentWriteCount = 0

  for (let i = 0; i < SUBAGENT_MAX_ITERATIONS; i++) {
    const response = await client.chat.completions.create({
      model: modelName,
      messages,
      tools: openaiTools.length > 0 ? openaiTools : undefined,
    })

    if (response.usage?.total_tokens) {
      totalTokens += response.usage.total_tokens
    }

    const msg = response.choices[0]!.message

    if (!msg.tool_calls?.length) {
      return { resultText: msg.content ?? '(no output)', totalTokens }
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
      try {
        parsedArgs = JSON.parse(fn.arguments)
      } catch (parseErr: unknown) {
        messages.push({ role: 'tool', tool_call_id: tc.id, content: `Error: failed to parse tool arguments — ${(parseErr as Error).message ?? 'invalid JSON'}` })
        continue
      }

      callbacks?.onToolUse?.(agentId, fn.name, buildToolPreview(fn.name, parsedArgs))

      const agentPermissions = callbacks?.permissions
      const effectivePermissions = callbacks?.permissionPolicy === 'isolated'
        ? {
            allow: agentPermissions?.allow,
            deny: [...new Set([...(settings.permissions?.deny ?? []), ...(agentPermissions?.deny ?? [])])],
          }
        : {
            allow: [...new Set([...(settings.permissions?.allow ?? []), ...(agentPermissions?.allow ?? [])])],
            deny: [...new Set([...(settings.permissions?.deny ?? []), ...(agentPermissions?.deny ?? [])])],
          }
      const permDecision = resolvePermission(effectivePermissions, fn.name, parsedArgs)
      if (permDecision === 'deny') {
        messages.push({ role: 'tool', tool_call_id: tc.id, content: `Tool '${fn.name}' blocked by permission rule.` })
        continue
      }

      // Risk-level check: subagents are blocked on HIGH and MEDIUM
      if (fn.name === 'write_file' || fn.name === 'patch_file') {
        subAgentWriteCount++
      }
      const riskResult = assessRisk(fn.name, parsedArgs, {
        isSubAgent: true,
        recentWriteCount: subAgentWriteCount,
        config: settings.risk ?? {},
      })
      if (riskResult?.requiresConfirmation) {
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: `⚠️ Tool '${fn.name}' blocked: ${riskResult.level} risk in subagent context (${riskResult.description}). The parent agent must execute this operation directly.`,
        })
        continue
      }

      const tool = subagentToolMap.get(fn.name)
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

  return { resultText: '(subagent reached max iterations)', totalTokens }
}
