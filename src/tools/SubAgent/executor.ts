import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'
import type { ProviderConfig } from '../../types/provider.js'
import type { AgentPermissionConfig } from '../../agent/config.js'
import type { Tool } from '../types.js'
import type { ToolExecutionContext } from '../../orchestration/types.js'
import { createLLMClient } from '../../agent/llmClient.js'
import { SUBAGENT_MAX_ITERATIONS } from '../../constants.js'
import { resolvePermission } from '../../permissions/matcher.js'
import { assessRisk } from '../../permissions/risk.js'
import { loadMergedSettings } from '../../settings/loader.js'
import { validateSchema, validateToolArguments } from '../../orchestration/schema.js'
import { StructuredOutputError } from './contracts.js'
import { isToolAllowedForProfile } from './permissions.js'
import { TaskRuntimeError } from '../../orchestration/lifecycle.js'
import { isDeepStrictEqual } from 'node:util'

export interface ExecutorCallbacks {
  onToolUse?(id: string, tool: string, info?: string): void
  permissionPolicy?: 'inherit' | 'isolated'
  permissions?: AgentPermissionConfig
}

export interface TerminalTool<T> {
  name: string
  description: string
  schema: object
  maxValidationRetries?: number
  transform?(value: unknown): T
}

export interface SubAgentLoopOptions<T> {
  callbacks?: ExecutorCallbacks
  context?: ToolExecutionContext
  terminal?: TerminalTool<T>
  client?: ReturnType<typeof createLLMClient>
  effort?: 'low' | 'high' | 'max'
}

export interface SubAgentLoopResult<T = never> {
  resultText: string
  terminalResult?: T
  rawOutput: string
  totalTokens: number
}

export function buildToolPreview(toolName: string, args: Record<string, unknown>): string {
  const str = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value)
  const truncate = (value: string, length = 50) => value.length > length ? `${value.slice(0, length)}…` : value
  const selected: Record<string, unknown> = {
    read_file: args.path, write_file: args.path, patch_file: args.path, edit_file: args.path,
    read_folder: args.path, shell: args.command, grep: `${args.pattern ?? ''} in ${args.path ?? '.'}`,
    glob: args.pattern, web_fetch: args.url, subagent: args.task,
  }
  const value = selected[toolName] ?? Object.values(args).find(item => typeof item === 'string') ?? ''
  return truncate(str(value))
}

export async function runSubAgentLoop<T = never>(
  prompt: string,
  task: string,
  agentId: string,
  filteredTools: Tool[],
  provider: ProviderConfig,
  modelName: string,
  options: SubAgentLoopOptions<T> = {},
): Promise<SubAgentLoopResult<T>> {
  const toolMap = new Map(filteredTools.map(tool => [tool.name, tool]))
  const tools: ChatCompletionTool[] = filteredTools.map(tool => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters as Record<string, unknown> },
  }))
  if (options.terminal) {
    tools.push({ type: 'function', function: { name: options.terminal.name, description: options.terminal.description, parameters: options.terminal.schema as Record<string, unknown> } })
  }

  const client = options.client ?? createLLMClient(provider, modelName)
  const messages: ChatCompletionMessageParam[] = [{ role: 'system', content: prompt }, { role: 'user', content: task }]
  const raw: string[] = []
  let totalTokens = 0
  let writeCount = 0
  let validationFailures = 0
  const maxValidationRetries = options.terminal?.maxValidationRetries ?? 1

  for (let iteration = 0; iteration < SUBAGENT_MAX_ITERATIONS; iteration++) {
    if (options.context?.signal?.aborted) throw options.context.signal.reason
    // Drain coordinator 'question' messages (posted via agent.controlTask(id, 'message', text))
    // into the conversation so a running subagent reacts to the user mid-run.
    if (options.context?.taskId && options.context.session) {
      const inbox = options.context.session.registry.mailbox.list(options.context.taskId, 'pending')
      for (const message of inbox) {
        if (message.type !== 'question') continue
        const text = String(message.payload.text ?? '')
        if (text.trim()) {
          // The focused-subagent UI already shows the user's message via an
          // optimistic append in App.tsx, so re-emitting it here would duplicate
          // the transcript row. It still reaches the model via messages.push.
          messages.push({ role: 'user', content: text })
        }
        options.context.session.registry.acknowledgeMessage(message.messageId)
      }
    }
    const effortParams = (provider.provider === 'deepseek' || provider.provider === 'bedrock') && options.effort
      ? options.effort === 'low'
        ? { thinking: { type: 'disabled' } }
        : { reasoning_effort: options.effort, thinking: { type: 'enabled' } }
      : {}
    const response = await client.chat.completions.create({
      model: modelName, messages, tools: tools.length > 0 ? tools : undefined, ...effortParams,
    } as any, { signal: options.context?.signal })
    totalTokens += response.usage?.total_tokens ?? 0
    // The verifier loop runs with the parent's toolContext (real taskId), so its
    // emissions would leak verifier progress into the subagent's transcript and
    // reset the footer's ↓ tokens. Detect it by the synthetic agentId suffix.
    const isVerifier = agentId.endsWith('-v')
    if (!isVerifier && totalTokens > 0) options.context?.emit?.('token_progress', { tokens: totalTokens })
    if (options.context?.maxTokens !== undefined && totalTokens > options.context.maxTokens) {
      throw new TaskRuntimeError('TOKEN_BUDGET_EXCEEDED', `Subagent used ${totalTokens} tokens; limit is ${options.context.maxTokens}`)
    }
    const message = response.choices[0]?.message
    if (!message) throw new StructuredOutputError('INVALID_RESULT', 'Model returned no message', raw.join('\n'))
    if (message.content) raw.push(message.content)
    // Emit transcript deltas only — the full `messages` array holds the system
    // prompt and large tool results and must not be re-sent every iteration.
    // Skip for the verifier loop (would leak verifier reasoning into the transcript).
    if (!isVerifier && message.content) options.context?.emit?.('subagent_message', { role: 'assistant', content: message.content })

    if (!message.tool_calls?.length) {
      if (!options.terminal) return { resultText: message.content ?? '', rawOutput: raw.join('\n'), totalTokens }
      validationFailures++
      if (validationFailures > maxValidationRetries) throw new StructuredOutputError('INVALID_RESULT', `Missing terminal call '${options.terminal.name}'`, raw.join('\n'))
      messages.push({ role: 'assistant', content: message.content ?? null })
      messages.push({ role: 'user', content: `Invalid final output. Call ${options.terminal.name} exactly once with schema-valid arguments.` })
      continue
    }

    const assistantMessage: ChatCompletionMessageParam & { reasoning_content?: string } = {
      role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls,
    }
    const reasoning = (message as unknown as Record<string, unknown>).reasoning_content
    if (typeof reasoning === 'string' && reasoning) assistantMessage.reasoning_content = reasoning
    messages.push(assistantMessage)

    const terminalCalls = message.tool_calls.filter(call => (call as { function?: { name: string } }).function?.name === options.terminal?.name)
    if (options.terminal && terminalCalls.length > 0) {
      const invalidShape = terminalCalls.length !== 1 || message.tool_calls.length !== 1 || Boolean(message.content?.trim())
      const call = terminalCalls[0] as typeof terminalCalls[number] & { function: { name: string; arguments: string } }
      let value: unknown
      let errors: string[] = invalidShape ? ['terminal call must be the only final output'] : []
      if (!invalidShape) {
        try { value = JSON.parse(call.function.arguments) } catch (error) { errors = [`invalid JSON: ${(error as Error).message}`] }
        if (errors.length === 0) {
          const validation = validateSchema(options.terminal.schema, value)
          if (!validation.valid) errors = validation.errors
        }
      }
      raw.push(call.function.arguments)
      if (errors.length === 0) {
        const result = options.terminal.transform ? options.terminal.transform(value) : value as T
        return { resultText: message.content ?? '', terminalResult: result, rawOutput: raw.join('\n'), totalTokens }
      }
      validationFailures++
      for (const toolCall of message.tool_calls) {
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: `Invalid terminal output: ${errors.join('; ')}` })
      }
      if (validationFailures > maxValidationRetries) throw new StructuredOutputError('INVALID_RESULT', `Invalid terminal output: ${errors.join('; ')}`, raw.join('\n'))
      continue
    }

    const settings = options.context?.session?.runtimeSnapshot().settings ?? await loadMergedSettings(options.context?.projectRoot)
    for (const call of message.tool_calls) {
      if (options.context?.signal?.aborted) throw options.context.signal.reason
      if (!('function' in call)) continue
      let args: Record<string, unknown>
      try { args = JSON.parse(call.function.arguments) as Record<string, unknown> } catch (error) {
        messages.push({ role: 'tool', tool_call_id: call.id, content: `Error: invalid tool arguments — ${(error as Error).message}` })
        continue
      }
      raw.push(`${call.function.name}:${call.function.arguments}`)
      const tool = toolMap.get(call.function.name)
      if (!tool) {
        messages.push({ role: 'tool', tool_call_id: call.id, content: `Unknown tool: ${call.function.name}` })
        continue
      }
      const validation = validateToolArguments(tool.parameters, args)
      if (!validation.valid) {
        messages.push({ role: 'tool', tool_call_id: call.id, content: `Invalid tool arguments: ${validation.errors.join('; ')}` })
        continue
      }
      if (options.context && !isToolAllowedForProfile(options.context.permissionProfile, call.function.name)) {
        const reason = `Tool '${call.function.name}' is outside permission profile '${options.context.permissionProfile}'`
        options.context.emit?.('authorization', { tool: call.function.name, decision: 'deny', reason })
        messages.push({ role: 'tool', tool_call_id: call.id, content: reason })
        continue
      }
      if (options.context && Array.isArray(options.context.allowedTools) && !options.context.allowedTools.includes(call.function.name)) {
        const reason = `Tool '${call.function.name}' is outside this task's explicit allowlist`
        options.context.emit?.('authorization', { tool: call.function.name, decision: 'deny', reason })
        messages.push({ role: 'tool', tool_call_id: call.id, content: reason })
        continue
      }
      options.callbacks?.onToolUse?.(agentId, call.function.name, buildToolPreview(call.function.name, args))
      options.context?.emit?.('tool_started', { tool: call.function.name, info: buildToolPreview(call.function.name, args) })

      const agentPermissions = options.callbacks?.permissions
      const permissions = options.callbacks?.permissionPolicy === 'isolated'
        ? { allow: agentPermissions?.allow, deny: [...new Set([...(settings.permissions?.deny ?? []), ...(agentPermissions?.deny ?? [])])] }
        : { allow: [...new Set([...(settings.permissions?.allow ?? []), ...(agentPermissions?.allow ?? [])])], deny: [...new Set([...(settings.permissions?.deny ?? []), ...(agentPermissions?.deny ?? [])])] }
      const registry = options.context?.taskId && options.context.session ? options.context.session.registry : undefined
      const permissionGrant = registry?.mailbox.list(options.context!.taskId, 'pending').find(message => {
        if (message.type !== 'permission' || message.senderId !== 'coordinator' ||
            message.payload.tool !== call.function.name || !['allow', 'deny'].includes(String(message.payload.decision))) return false
        const request = registry.mailbox.list('coordinator', 'pending').find(candidate => candidate.messageId === message.payload.requestId)
        return Boolean(request && request.taskId === options.context!.taskId && request.senderId === options.context!.taskId &&
          request.type === 'permission' && request.payload.tool === call.function.name && isDeepStrictEqual(request.payload.args, args))
      })
      const decision = permissionGrant ? String(permissionGrant.payload.decision) as 'allow' | 'deny' : resolvePermission(permissions, call.function.name, args)
      if (permissionGrant) {
        registry!.acknowledgeMessage(permissionGrant.messageId)
        registry!.acknowledgeMessage(String(permissionGrant.payload.requestId))
        options.context?.emit?.('authorization', { tool: call.function.name, decision, source: 'coordinator_message', messageId: permissionGrant.messageId })
      }
      if (decision !== 'allow') {
        const reason = decision === 'ask' ? `Tool '${call.function.name}' requires coordinator permission` : `Tool '${call.function.name}' is denied`
        options.context?.emit?.('authorization', { tool: call.function.name, decision, reason })
        if (decision === 'ask' && options.context?.taskId && options.context.session) {
          options.context.session.registry.sendMessage(options.context.taskId, 'permission', { tool: call.function.name, args, reason }, 'coordinator', options.context.taskId)
          options.context.session.registry.block(options.context.taskId, reason)
          throw new TaskRuntimeError('BLOCKED', reason, true)
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: reason })
        continue
      }

      if (['write_file', 'patch_file', 'edit_file'].includes(call.function.name)) writeCount++
      const risk = assessRisk(call.function.name, args, { isSubAgent: true, recentWriteCount: writeCount, config: settings.risk ?? {} })
      if (risk?.requiresConfirmation) {
        const reason = `Tool '${call.function.name}' blocked: ${risk.level} risk (${risk.description})`
        options.context?.emit?.('authorization', { tool: call.function.name, decision: 'deny', reason })
        messages.push({ role: 'tool', tool_call_id: call.id, content: reason })
        continue
      }

      let result: string
      try { result = await tool.execute(args, options.context) } catch (error) { result = `Error: ${(error as Error).message}` }
      options.context?.emit?.('tool_finished', { tool: call.function.name, result: result.slice(0, 200) })
      messages.push({ role: 'tool', tool_call_id: call.id, content: result })
    }
  }
  throw new StructuredOutputError('MAX_ITERATIONS', `Subagent reached maximum iteration limit (${SUBAGENT_MAX_ITERATIONS})`, raw.join('\n'))
}
