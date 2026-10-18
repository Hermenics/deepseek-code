import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'
import type { ProviderConfig } from '../../types/provider.js'
import type { AgentPermissionConfig } from '../../agent/config.js'
import type { Tool } from '../types.js'
import { formatToolError, isToolErrorResult, normalizeToolException, normalizeToolResult } from '../result.js'
import type { ToolExecutionContext } from '../../orchestration/types.js'
import { createLLMClient } from '../../agent/llmClient.js'
import { estimateCost, hasVerifiedDeepSeekPricing, type TokenUsage } from '../../agent/cost.js'
import { resolvePermission } from '../../permissions/matcher.js'
import { assessRisk } from '../../permissions/risk.js'
import { loadMergedSettings } from '../../settings/loader.js'
import { validateSchema, validateToolArguments } from '../../orchestration/schema.js'
import { StructuredOutputError } from './contracts.js'
import { isToolAllowedForProfile } from './permissions.js'
import { TaskRuntimeError } from '../../orchestration/lifecycle.js'
import { isDeepStrictEqual } from 'node:util'
import { captureGitMutationVersion, isGitMutation } from '../../agent/gitMutationVersion.js'
import { runPermissionRequestHooks } from '../../hooks/lifecycle.js'
import { DurableExecutionError } from '../../orchestration/OrchestratorSession.js'
import { SessionEvidence } from '../../agent/sessionEvidence.js'
import { AGGREGATE_SOURCE_ACCOUNTED_TOOL_NAMES, assertProviderRequestBudget, boundToolMessages, CONVERSATION_MESSAGE_BYTES, nativeToolBatchFitsBudget, nativeToolResultEnvelopeBytes, TOOL_BATCH_BYTES } from '../../agent/toolOutputBudget.js'
import { createToolDiscovery } from '../../agent/toolDiscovery.js'
import { redactSecrets } from '../../orchestration/events.js'
import { safeGraphemeEnd } from '../../utils/textBoundaries.js'

const CONTEXTLESS_TIMEOUT_MS = 120_000
const sessionEvidenceByTask = new WeakMap<object, Map<string, SessionEvidence>>()
// shortcut: only core local reads are allowlisted; expand after verifying a tool's full effect behavior.
const RETRY_SAFE_READ_TOOLS = new Set(['read_file', 'read_folder', 'grep', 'glob', 'introspect', 'get_goal', 'session_evidence', 'discover_tools'])
const READ_ONLY_GIT_ACTIONS = new Set(['status', 'diff', 'log'])
const userDeniedToolResult = (toolName: string) => formatToolError('permission', 'USER_DENIED',
  `The user denied this ${toolName} action. It was not run. Do not retry it; continue with an independent permitted action or ask the user for an allowed alternative.`)
const RAW_OUTPUT_TRUNCATION = '\n[Subagent raw output truncated at the 4 MiB serialized UTF-8 limit.]'

function serializedUtf8Bytes(value: unknown): number {
  let serialized: string | undefined
  try { serialized = JSON.stringify(value) }
  catch { throw new TaskRuntimeError('INVALID_PROVIDER_RESPONSE', 'Provider message could not be serialized for size validation') }
  if (serialized === undefined) throw new TaskRuntimeError('INVALID_PROVIDER_RESPONSE', 'Provider message was unavailable for size validation')
  return Buffer.byteLength(serialized, 'utf8')
}

function assertProviderResponseBudget(message: unknown): void {
  const bytes = serializedUtf8Bytes(message)
  if (bytes > CONVERSATION_MESSAGE_BYTES) {
    throw new TaskRuntimeError('PROVIDER_RESPONSE_TOO_LARGE', `Serialized provider response message exceeds the 4 MiB UTF-8 limit (${bytes} bytes)`)
  }
}

function boundSerializedText(text: string): { value: string; truncated: boolean } {
  if (serializedUtf8Bytes(text) <= CONVERSATION_MESSAGE_BYTES) return { value: text, truncated: false }

  let low = 0
  let high = text.length
  while (low < high) {
    const end = Math.ceil((low + high) / 2)
    if (serializedUtf8Bytes(text.slice(0, end) + RAW_OUTPUT_TRUNCATION) <= CONVERSATION_MESSAGE_BYTES) low = end
    else high = end - 1
  }
  low = safeGraphemeEnd(text, low)
  return { value: text.slice(0, low) + RAW_OUTPUT_TRUNCATION, truncated: true }
}

function policyDeniedToolResult(code: string, reason: string, nextStep: string): string {
  return formatToolError('permission', code, `${reason}. No action was run. Do not retry this action; ${nextStep}`)
}

function isRetrySafeReadToolCall(name: string, args: Record<string, unknown>): boolean {
  if (RETRY_SAFE_READ_TOOLS.has(name)) return true
  if (name === 'shell') return typeof args.output_id === 'string' && args.command === undefined
  if (name !== 'git') return false
  if (READ_ONLY_GIT_ACTIONS.has(String(args.action))) return true
  if (args.action === 'branch') return !args.create && !(args as { switch?: unknown }).switch
  return args.action === 'batch' && Array.isArray(args.operations)
    && args.operations.every(operation => !!operation && typeof operation === 'object'
      && READ_ONLY_GIT_ACTIONS.has(String((operation as Record<string, unknown>).action)))
}

function outputArtifactId(result: string): string | undefined {
  try {
    const parsed = JSON.parse(result) as { outputId?: unknown; partial?: { outputId?: unknown } }
    const id = parsed.partial?.outputId ?? parsed.outputId
    return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : undefined
  } catch { return undefined }
}

function outputQuotaError(result: string): string {
  const outputId = outputArtifactId(result)
  return formatToolError('tool', 'AGGREGATE_OUTPUT_BYTES_EXCEEDED',
    `The shared per-turn tool-result byte quota was exhausted; this result was omitted from model context.${outputId ? ' Its artifact reference is retained in the partial result.' : ' Use a smaller result or reduce earlier captured output before retrying.'}`,
    false, { outputOmitted: true, ...(outputId ? { outputId } : {}) })
}

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
  /** Usage already spent on this task (the verifier passes the worker's), counted toward budgets and metrics. */
  baseUsage?: Pick<SubAgentLoopResult, 'totalTokens' | 'costUsd' | 'usage' | 'usageAvailable' | 'costAvailable'>
}

export interface SubAgentLoopResult<T = never> {
  resultText: string
  terminalResult?: T
  rawOutput: string
  totalTokens: number
  /** Estimated from the reported usage with the parent's price table (agent/cost.ts). */
  costUsd: number
  usage: TokenUsage
  usageAvailable: boolean
  costAvailable: boolean
}

/** Short (50-char) label for a subagent tool call in the UI: the tool's key argument (path, command, pattern, url, task), or else its first string argument. */
export function buildToolPreview(toolName: string, args: Record<string, unknown>): string {
  const str = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value)
  /** Shortens a preview to `length` characters. */
  const truncate = (value: string, length = 50) => value.length > length ? `${value.slice(0, length)}…` : value
  const selected: Record<string, unknown> = {
    read_file: args.path, write_file: args.path, patch_file: args.path, edit_file: args.path,
    read_folder: args.path, shell: args.command, grep: `${args.pattern ?? ''} in ${args.path ?? '.'}`,
    glob: args.pattern, web_fetch: args.url, subagent: args.task,
  }
  const value = selected[toolName] ?? Object.values(args).find(item => typeof item === 'string') ?? ''
  return truncate(str(value))
}

/**
 * Same output ceiling as the parent (Agent.getSamplingParams): the official DeepSeek API caps output
 * at 4K tokens without max_tokens, which truncates long file writes mid-JSON.
 */
function outputLimit(provider: ProviderConfig, options: SubAgentLoopOptions<unknown>, modelName: string, budget?: { maxTokens?: number; maxCostUsd?: number }, pricedAt = new Date()): { max_tokens?: number } {
  const model = options.context?.session?.runtimeSnapshot().settings.model
  const configured = typeof model === 'object' ? model.maxOutputTokens : undefined
  let maxTokens = typeof configured === 'number' && configured > 0
    ? Math.floor(configured)
    : provider.provider === 'deepseek' ? (options.effort === 'low' ? 8192 : 32768) : 32768
  if (budget?.maxTokens !== undefined) maxTokens = Math.min(maxTokens ?? budget.maxTokens, budget.maxTokens)
  if (budget?.maxCostUsd !== undefined) {
    const costPerOutputToken = estimateCost(modelName, { promptTokens: 0, completionTokens: 1, cachedTokens: 0 }, pricedAt)
    if (costPerOutputToken > 0) {
      const costTokenLimit = Math.floor(budget.maxCostUsd / costPerOutputToken)
      if (costTokenLimit < 1) throw new TaskRuntimeError('AGGREGATE_BUDGET_EXHAUSTED', 'Remaining estimated cost is below one output token')
      maxTokens = Math.min(maxTokens ?? costTokenLimit, costTokenLimit)
    }
  }
  return maxTokens === undefined ? {} : { max_tokens: maxTokens }
}

/** Runs a subagent until it answers or calls its terminal tool, tracking tokens and cost against the task budget. */
export async function runSubAgentLoop<T = never>(
  prompt: string,
  task: string,
  agentId: string,
  filteredTools: Tool[],
  provider: ProviderConfig,
  modelName: string,
  options: SubAgentLoopOptions<T> = {},
): Promise<SubAgentLoopResult<T>> {
  const hasVerifiedPricing = hasVerifiedDeepSeekPricing(provider, modelName)
  if (options.context?.maxCostUsd !== undefined && !hasVerifiedPricing) {
    throw new TaskRuntimeError('COST_BUDGET_UNAVAILABLE', 'No verified provider/model price is available; the cost-limited worker was not started')
  }
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
  // Each delegated worker gets a private recovery ledger, retained only in the
  // owning session's runtime memory so a permission retry can recover its own
  // prior sources. Parent-session evidence is never copied into this view.
  let taskEvidence: SessionEvidence | undefined
  if (options.context?.session) {
    let byTask = sessionEvidenceByTask.get(options.context.session)
    if (!byTask) { byTask = new Map(); sessionEvidenceByTask.set(options.context.session, byTask) }
    taskEvidence = byTask.get(agentId)
    if (!taskEvidence) { taskEvidence = new SessionEvidence(); byTask.set(agentId, taskEvidence) }
  }
  const evidence = taskEvidence ?? new SessionEvidence()
  if (!evidence.latest('subagent-task')) evidence.add('request', 'subagent-task', task)
  const releaseEvidence = () => {
    if (!options.context?.session) return
    const byTask = sessionEvidenceByTask.get(options.context.session)
    byTask?.delete(agentId)
    if (byTask?.size === 0) sessionEvidenceByTask.delete(options.context.session)
  }
  const evidenceByCall = new Map<string, string>()
  const discoverableTools = filteredTools.filter(tool => {
    if (options.context && !isToolAllowedForProfile(options.context.permissionProfile, tool.name)) return false
    const allowlist = options.context?.allowedTools
    return allowlist === undefined || allowlist === '*' || allowlist.includes(tool.name)
  })
  const childContext = options.context ? {
    ...options.context,
    readSessionEvidence: (id?: string, start?: number, limit?: number) => evidence.read(id, start, limit),
    recordSessionClaim: (claim: Parameters<SessionEvidence['recordClaim']>[0]) => evidence.recordClaim(claim),
    recordVerification: (result: import('../../agent/verify.js').VerificationResult) => evidence.add('tool', 'verification', JSON.stringify(result)),
    discoverTools: createToolDiscovery(discoverableTools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters }))),
  } : undefined
  let outputQuotaRejected = false
  const pushToolResult = (callId: string, toolName: string, initialContent: string): string => {
    let content = initialContent
    if (AGGREGATE_SOURCE_ACCOUNTED_TOOL_NAMES.has(toolName)) {
      if (isToolErrorResult(content) && JSON.parse(content).error.code === 'AGGREGATE_OUTPUT_BYTES_EXCEEDED') outputQuotaRejected = true
    } else if (options.context?.session) {
      let accepted = false
      try {
        accepted = options.context.session.registry.recordAggregateOutputBytes(
          options.context.budgetGroupId, Buffer.byteLength(content, 'utf8'),
        ) === true
      } catch { /* A result whose byte accounting failed must not enter model context. */ }
      if (!accepted) {
        content = outputQuotaError(content)
        outputQuotaRejected = true
      }
    }
    if (!['session_evidence', 'record_claim'].includes(toolName)) evidenceByCall.set(callId, evidence.add('tool', `${toolName}:${callId}`, content))
    messages.push({ role: 'tool', tool_call_id: callId, content })
    return content
  }
  let rawOutput = ''
  let rawOutputTruncated = false
  const appendRawOutput = (text: string) => {
    if (rawOutputTruncated) return
    const next = rawOutput ? `${rawOutput}\n${text}` : text
    const bounded = boundSerializedText(next)
    rawOutput = bounded.value
    rawOutputTruncated = bounded.truncated
  }
  let totalTokens = 0
  let costUsd = 0
  const usageTotals: TokenUsage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 }
  const base = options.baseUsage
  let usageAvailable = base?.usageAvailable ?? true
  let costAvailable = base?.costAvailable ?? true
  let writeCount = 0
  let validationFailures = 0
  const maxValidationRetries = options.terminal?.maxValidationRetries ?? 1

  /**
   * Drains pending coordinator 'question' messages (posted via
   * agent.controlTask(id, 'message', text)) into the conversation so a running
   * subagent reacts to the user mid-run. Returns true when any question was
   * processed, so a caller can continue the loop instead of returning and
   * dropping the user's message.
   */
  const drainQuestions = () => {
    if (!options.context?.taskId || !options.context.session) return false
    const inbox = options.context.session.registry.mailbox.list(options.context.taskId, 'pending')
    let drained = false
    for (const message of inbox) {
      if (message.type !== 'question') continue
      const text = String(message.payload.text ?? '')
      if (text.trim()) {
        // The focused-subagent UI already shows the user's message via an
        // optimistic append in App.tsx, so re-emitting it here would duplicate
        // the transcript row. It still reaches the model via messages.push.
        messages.push({ role: 'user', content: text })
        drained = true
      }
      options.context.session.registry.acknowledgeMessage(message.messageId)
    }
    return drained
  }

  const contextlessDeadline = options.context ? undefined : Date.now() + CONTEXTLESS_TIMEOUT_MS
  while (true) {
    if (options.context?.signal?.aborted) throw options.context.signal.reason
    if (contextlessDeadline !== undefined && Date.now() >= contextlessDeadline) {
      throw new TaskRuntimeError('TIMED_OUT', `Subagent exceeded the default ${CONTEXTLESS_TIMEOUT_MS}ms time limit without a task context`)
    }
    drainQuestions()
    if (!agentId.endsWith('-v')) {
      for (const content of await options.context?.session?.beforeModelRequest(options.context.taskId) ?? []) messages.push({ role: 'user', content })
    }
    const effortParams = (provider.provider === 'deepseek' || provider.provider === 'bedrock') && options.effort
      ? options.effort === 'low'
        ? { thinking: { type: 'disabled' } }
        : { reasoning_effort: options.effort, thinking: { type: 'enabled' } }
      : {}
    const reference = await options.context?.session?.modelReference(options.context.taskId)
    const withReference = reference === undefined ? messages : [...messages, { role: 'user' as const, content: reference }]
    const claimContext = evidence.claimContext()
    const withClaims = claimContext ? [...withReference, { role: 'user' as const, content: claimContext }] : withReference
    const redactedMessages = redactSecrets(withClaims) as ChatCompletionMessageParam[]
    const apiMessages = boundToolMessages(redactedMessages, callId => evidenceByCall.get(callId))
    const usedTokens = (base?.totalTokens ?? 0) + totalTokens
    const usedCostUsd = (base?.costUsd ?? 0) + costUsd
    if (options.context?.maxTokens !== undefined && usedTokens >= options.context.maxTokens) {
      throw new TaskRuntimeError('TOKEN_BUDGET_EXCEEDED', `Subagent used ${usedTokens} tokens; limit is ${options.context.maxTokens}`)
    }
    if (options.context?.maxCostUsd !== undefined && base?.costAvailable === false) {
      throw new TaskRuntimeError('COST_BUDGET_UNAVAILABLE', 'Earlier worker responses lacked priceable usage; no further requests are allowed under the cost budget')
    }
    if (options.context?.maxCostUsd !== undefined && usedCostUsd >= options.context.maxCostUsd) {
      throw new TaskRuntimeError('COST_BUDGET_EXCEEDED', `Subagent cost $${usedCostUsd.toFixed(4)}; limit is $${options.context.maxCostUsd}`)
    }
    const budget = await options.context?.session?.registry.acquireAggregateBudget(options.context.budgetGroupId, options.context.signal)
    const remainingTaskTokens = options.context?.maxTokens === undefined ? undefined : options.context.maxTokens - usedTokens
    const remainingTaskCostUsd = options.context?.maxCostUsd === undefined ? undefined : options.context.maxCostUsd - usedCostUsd
    const requestBudget = {
      maxTokens: budget?.maxTokens === undefined ? remainingTaskTokens : remainingTaskTokens === undefined ? budget.maxTokens : Math.min(budget.maxTokens, remainingTaskTokens),
      maxCostUsd: budget?.maxCostUsd === undefined ? remainingTaskCostUsd : remainingTaskCostUsd === undefined ? budget.maxCostUsd : Math.min(budget.maxCostUsd, remainingTaskCostUsd),
    }
    if (requestBudget.maxCostUsd !== undefined && !hasVerifiedPricing) {
      budget?.release()
      throw new TaskRuntimeError('COST_BUDGET_UNAVAILABLE', 'No verified provider/model price is available; the cost-limited worker was not started')
    }
    let response: any
    let usage: ({ total_tokens?: number; prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } | undefined)
    let responseUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 }
    let responseTokens = 0
    let responseCostUsd = 0
    let tokenUsageAvailable = false
    let costUsageAvailable = false
    let budgetResult: ReturnType<NonNullable<typeof budget>['reportUsage']> | undefined
    const pricedAt = new Date()
    try {
      const request = {
        model: modelName, messages: apiMessages, tools: tools.length > 0 ? tools : undefined, ...effortParams, ...outputLimit(provider, options, modelName, requestBudget, pricedAt),
      }
      const requestBytes = assertProviderRequestBudget(request)
      budget?.reserveRequestBytes(requestBytes)
      response = await client.chat.completions.create(request as any, { signal: options.context?.signal })
      usage = response.usage as typeof usage
      const hasPromptAndCompletion = typeof usage?.prompt_tokens === 'number' && typeof usage.completion_tokens === 'number'
      tokenUsageAvailable = typeof usage?.total_tokens === 'number' || hasPromptAndCompletion
      responseTokens = typeof usage?.total_tokens === 'number'
        ? usage.total_tokens
        : hasPromptAndCompletion ? usage!.prompt_tokens! + usage!.completion_tokens! : 0
      responseUsage = {
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        cachedTokens: usage?.prompt_cache_hit_tokens ?? usage?.prompt_tokens_details?.cached_tokens ?? 0,
      }
      costUsageAvailable = hasVerifiedPricing && hasPromptAndCompletion
      responseCostUsd = costUsageAvailable ? estimateCost(modelName, responseUsage, pricedAt) : 0
      budgetResult = budget?.reportUsage({
        tokens: tokenUsageAvailable ? responseTokens : undefined,
        costUsd: costUsageAvailable ? responseCostUsd : undefined,
      })
    } finally {
      budget?.release()
    }
    totalTokens += responseTokens
    costUsd += responseCostUsd
    usageTotals.promptTokens += responseUsage.promptTokens
    usageTotals.completionTokens += responseUsage.completionTokens
    usageTotals.cachedTokens += responseUsage.cachedTokens
    usageAvailable = usageAvailable && tokenUsageAvailable
    costAvailable = costAvailable && costUsageAvailable
    const taskTokens = (base?.totalTokens ?? 0) + totalTokens
    const taskCostUsd = (base?.costUsd ?? 0) + costUsd
    // Record each response before any budget, validation, or tool-call exit can throw.
    if (options.context?.taskId && options.context.session) {
      options.context.session.registry.recordModelUsage(options.context.taskId, {
        model: modelName, provider: provider.provider,
        tokens: responseTokens, costUsd: responseCostUsd,
        promptTokens: responseUsage.promptTokens, completionTokens: responseUsage.completionTokens,
        cachedTokens: responseUsage.cachedTokens, usageAvailable: tokenUsageAvailable, costAvailable: costUsageAvailable,
      })
    }
    // The verifier loop runs with the parent's toolContext (real taskId), so its
    // emissions would leak verifier progress into the subagent's transcript and
    // reset the footer's ↓ tokens. Detect it by the synthetic agentId suffix.
    const isVerifier = agentId.endsWith('-v')
    if (!isVerifier && totalTokens > 0) options.context?.emit?.('token_progress', { tokens: totalTokens })
    const overTokens = options.context?.maxTokens !== undefined && taskTokens > options.context.maxTokens
    const overCost = options.context?.maxCostUsd !== undefined && taskCostUsd > options.context.maxCostUsd
    if (overTokens) throw new TaskRuntimeError('TOKEN_BUDGET_EXCEEDED', `Subagent used ${taskTokens} tokens; limit is ${options.context!.maxTokens}`)
    if (options.context?.maxTokens !== undefined && !tokenUsageAvailable) throw new TaskRuntimeError('TOKEN_BUDGET_UNAVAILABLE', 'Provider usage did not include token counts; no tools were executed under the token budget')
    if (overCost) throw new TaskRuntimeError('COST_BUDGET_EXCEEDED', `Subagent cost $${taskCostUsd.toFixed(4)}; limit is $${options.context!.maxCostUsd}`)
    if (options.context?.maxCostUsd !== undefined && !costUsageAvailable) throw new TaskRuntimeError('COST_BUDGET_UNAVAILABLE', 'Provider usage did not include prompt and completion counts; no tools were executed under the cost budget')
    if (budgetResult?.unavailable) throw new TaskRuntimeError('AGGREGATE_BUDGET_UNAVAILABLE', 'Provider usage was missing or incomplete; no further worker effects are allowed under the aggregate budget')
    if (budgetResult?.exceeded) throw new TaskRuntimeError('AGGREGATE_BUDGET_EXCEEDED', 'A model response exceeded the remaining aggregate worker budget; its tool calls were not executed')
    const message = response.choices[0]?.message
    if (!message) throw new StructuredOutputError('INVALID_RESULT', 'Model returned no message', rawOutput)
    assertProviderResponseBudget(message)
    if (budgetResult?.exhausted && message.tool_calls?.some((call: { function?: { name?: string } }) => call.function?.name !== options.terminal?.name)) {
      throw new TaskRuntimeError('AGGREGATE_BUDGET_EXHAUSTED', 'The worker budget is exhausted; remaining tool calls were not executed')
    }
    // A correction arriving during inference invalidates this proposed result
    // and its tool calls before permission or effects are admitted.
    if (!agentId.endsWith('-v')) {
      const guidance = await options.context?.session?.beforeModelRequest(options.context.taskId) ?? []
      if (guidance.length) {
        for (const content of guidance) messages.push({ role: 'user', content })
        continue
      }
    }
    if (message.content) appendRawOutput(message.content)
    // Emit transcript deltas only — the full `messages` array holds the system
    // prompt and large tool results and must not be re-sent every iteration.
    // Skip for the verifier loop (would leak verifier reasoning into the transcript).
    if (!isVerifier && message.content) options.context?.emit?.('subagent_message', { role: 'assistant', content: message.content })
    // Surface the subagent's live reasoning (thinking) so the focused view shows
    // it is actually working. The reasoning_content field is preserved for the API.
    const thinkingContent = (message as unknown as Record<string, unknown>).reasoning_content
    if (!isVerifier && typeof thinkingContent === 'string' && thinkingContent.trim()) {
      options.context?.emit?.('subagent_message', { role: 'thinking', content: thinkingContent })
    }

    if (!message.tool_calls?.length) {
      if (!options.terminal) {
        if (drainQuestions()) continue
        releaseEvidence()
        return { resultText: message.content ?? '', rawOutput, totalTokens, costUsd, usage: usageTotals, usageAvailable, costAvailable }
      }
      validationFailures++
      if (validationFailures > maxValidationRetries) throw new StructuredOutputError('INVALID_RESULT', `Missing terminal call '${options.terminal.name}'`, rawOutput)
      messages.push({ role: 'assistant', content: message.content ?? null })
      messages.push({ role: 'user', content: `Invalid final output. Call ${options.terminal.name} exactly once with schema-valid arguments.` })
      continue
    }

    const returnedCalls: readonly unknown[] = message.tool_calls
    if (!nativeToolBatchFitsBudget(returnedCalls)) {
      const callIds = returnedCalls.flatMap((call): string[] => {
        if (!call || typeof call !== 'object' || Array.isArray(call)) return []
        const id = (call as { id?: unknown }).id
        return typeof id === 'string' ? [id] : []
      })
      const resultEnvelopesBytes = nativeToolResultEnvelopeBytes(callIds)
      const reason = resultEnvelopesBytes > TOOL_BATCH_BYTES
        ? 'required tool-result envelopes exceed the round-trip budget'
        : 'serialized tool-call payload exceeds the round-trip budget'
      throw new TaskRuntimeError('TOOL_BATCH_TOO_LARGE', `Delegated tool-call batch rejected before execution: ${reason}. Split the calls.`)
    }

    const assistantMessage: ChatCompletionMessageParam & { reasoning_content?: string } = {
      role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls,
    }
    const reasoning = (message as unknown as Record<string, unknown>).reasoning_content
    if (typeof reasoning === 'string' && reasoning) assistantMessage.reasoning_content = reasoning
    messages.push(assistantMessage)

    const terminalCalls = message.tool_calls.filter((call: { function?: { name?: string } }) => call.function?.name === options.terminal?.name)
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
      appendRawOutput(call.function.arguments)
      if (errors.length === 0) {
        const result = options.terminal.transform ? options.terminal.transform(value) : value as T
        if (drainQuestions()) continue
        releaseEvidence()
        return { resultText: message.content ?? '', terminalResult: result, rawOutput, totalTokens, costUsd, usage: usageTotals, usageAvailable, costAvailable }
      }
      validationFailures++
      for (const toolCall of message.tool_calls) {
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: `Invalid terminal output: ${errors.join('; ')}` })
      }
      if (validationFailures > maxValidationRetries) throw new StructuredOutputError('INVALID_RESULT', `Invalid terminal output: ${errors.join('; ')}`, rawOutput)
      continue
    }

    const settings = options.context?.session?.runtimeSnapshot().settings ?? await loadMergedSettings(options.context?.projectRoot)
    outputQuotaRejected = false
    for (const call of message.tool_calls) {
      if (options.context?.signal?.aborted) throw options.context.signal.reason
      if (!('function' in call)) continue
      let args: Record<string, unknown>
      try { args = JSON.parse(call.function.arguments) as Record<string, unknown> } catch (error) {
        pushToolResult(call.id, call.function.name, formatToolError('validation', 'INVALID_ARGUMENTS', `Invalid tool arguments: ${(error as Error).message}`))
        continue
      }
      appendRawOutput(`${call.function.name}:${call.function.arguments}`)
      const tool = toolMap.get(call.function.name)
      if (!tool) {
        pushToolResult(call.id, call.function.name, formatToolError('tool', 'UNKNOWN_TOOL', `Unknown tool: ${call.function.name}`))
        continue
      }
      const validation = validateToolArguments(tool.parameters, args)
      const selectedExecutor = tool.execute
      const selectedDescriptor = JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters })
      if (!validation.valid) {
        pushToolResult(call.id, call.function.name, formatToolError('validation', 'INVALID_ARGUMENTS', validation.errors.join('; ')))
        continue
      }
      args = validation.value!
      if (options.context && !isToolAllowedForProfile(options.context.permissionProfile, call.function.name)) {
        const reason = `Tool '${call.function.name}' is outside permission profile '${options.context.permissionProfile}'`
        options.context.emit?.('authorization', { tool: call.function.name, decision: 'deny', reason })
        evidence.add('denial', call.function.name, JSON.stringify({ args, reason }))
        pushToolResult(call.id, call.function.name, policyDeniedToolResult('AGENT_CONFIG_DENIED', reason, 'continue with an independent permitted action or ask the coordinator to review the agent profile'))
        continue
      }
      if (options.context && Array.isArray(options.context.allowedTools) && !options.context.allowedTools.includes(call.function.name)) {
        const reason = `Tool '${call.function.name}' is outside this task's explicit allowlist`
        options.context.emit?.('authorization', { tool: call.function.name, decision: 'deny', reason })
        evidence.add('denial', call.function.name, JSON.stringify({ args, reason }))
        pushToolResult(call.id, call.function.name, policyDeniedToolResult('AGENT_CONFIG_DENIED', reason, 'continue with an independent permitted action or ask the coordinator to review the task allowlist'))
        continue
      }
      if (outputQuotaRejected && !isRetrySafeReadToolCall(call.function.name, args)) {
        pushToolResult(call.id, call.function.name, formatToolError('tool', 'AGGREGATE_OUTPUT_BYTES_EXCEEDED',
          'An earlier captured result exhausted the shared per-turn output quota; this effectful tool call was not run.'))
        continue
      }
      let gitVersion: Awaited<ReturnType<typeof captureGitMutationVersion>> | undefined
      if (isGitMutation(call.function.name, args)) {
        if (!options.context?.workspacePath) {
          pushToolResult(call.id, call.function.name, formatToolError('conflict', 'GIT_WORKSPACE_REQUIRED', 'Git mutation requires an owning workspace context; no action was started.'))
          continue
        }
        try { gitVersion = await captureGitMutationVersion(options.context.workspacePath, options.context.signal) }
        catch (error) {
          pushToolResult(call.id, call.function.name, formatToolError('conflict', 'GIT_IDENTITY_UNAVAILABLE', `Git authorization identity unavailable: ${(error as Error).message}`))
          continue
        }
      }
      options.callbacks?.onToolUse?.(agentId, call.function.name, redactSecrets(buildToolPreview(call.function.name, args)) as string)
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
        if (!request || request.taskId !== options.context!.taskId || request.senderId !== options.context!.taskId ||
          request.type !== 'permission' || request.payload.tool !== call.function.name || !isDeepStrictEqual(request.payload.args, args)) return false
        if (message.payload.decision === 'allow' && gitVersion && !isDeepStrictEqual(request.payload.gitVersion, gitVersion)) {
          registry.acknowledgeMessage(message.messageId)
          registry.acknowledgeMessage(request.messageId)
          options.context?.emit?.('authorization', { tool: call.function.name, decision: 'deny', source: 'stale_git_permission', reason: 'Git approval identity no longer matches; request current authorization.' })
          return false
        }
        return true
      })
      const policyDecision = resolvePermission(permissions, call.function.name, args)
      const configuredDecision = permissionGrant && policyDecision !== 'deny' ? String(permissionGrant.payload.decision) as 'allow' | 'deny' : policyDecision
      const hookDecision: Awaited<ReturnType<typeof runPermissionRequestHooks>> = configuredDecision === 'ask'
        ? await runPermissionRequestHooks(settings.hooks, call.function.name, args, options.context?.sessionId ?? '', { cwd: options.context?.workspacePath, model: modelName }, options.context?.signal)
        : { decision: 'pass' as const }
      let decision = hookDecision.decision === 'block'
        ? 'deny' as const
        : hookDecision.approved
          ? 'allow' as const
          : configuredDecision
      let userDenied = false
      if (decision === 'ask') {
        const review = options.context?.session?.requestToolPermission(call.function.name, args, options.context.taskId)
        if (review) {
          decision = await review
          userDenied = decision === 'deny'
        }
      }
      if (permissionGrant) {
        registry!.acknowledgeMessage(permissionGrant.messageId)
        registry!.acknowledgeMessage(String(permissionGrant.payload.requestId))
        options.context?.emit?.('authorization', { tool: call.function.name, decision, source: 'coordinator_message', messageId: permissionGrant.messageId })
        if (permissionGrant.payload.decision === 'deny' && policyDecision !== 'deny') userDenied = true
      }
      if (decision !== 'allow') {
        const reason = hookDecision.reason ?? (decision === 'ask' ? `Tool '${call.function.name}' requires coordinator permission` : `Tool '${call.function.name}' is denied`)
        options.context?.emit?.('authorization', { tool: call.function.name, decision, reason })
        if (decision === 'ask' && options.context?.taskId && options.context.session) {
          evidence.add('denial', call.function.name, JSON.stringify({ args, reason }))
          options.context.session.registry.sendMessage(options.context.taskId, 'permission', { tool: call.function.name, args, reason, ...(gitVersion ? { gitVersion } : {}) }, 'coordinator', options.context.taskId)
          options.context.session.registry.block(options.context.taskId, reason)
          throw new TaskRuntimeError('BLOCKED', reason, true)
        }
        evidence.add('denial', call.function.name, JSON.stringify({ args, reason }))
        const refusal = userDenied
          ? userDeniedToolResult(call.function.name)
          : decision === 'ask'
            ? policyDeniedToolResult('PERMISSION_REQUIRED', reason, 'ask the coordinator to authorize the action or continue with independent permitted work')
            : policyDeniedToolResult('POLICY_DENIED', reason, 'continue with an independent permitted action or ask the coordinator to review the current policy')
        pushToolResult(call.id, call.function.name, refusal)
        continue
      }

      if (['write_file', 'patch_file', 'edit_file'].includes(call.function.name)) writeCount++
      const risk = assessRisk(call.function.name, args, { isSubAgent: true, recentWriteCount: writeCount, config: settings.risk ?? {} })
      if (risk?.requiresConfirmation) {
        const reason = `Tool '${call.function.name}' blocked: ${risk.level} risk (${risk.description})`
        options.context?.emit?.('authorization', { tool: call.function.name, decision: 'deny', reason })
        evidence.add('denial', call.function.name, JSON.stringify({ args, reason }))
        pushToolResult(call.id, call.function.name, policyDeniedToolResult('RISK_CONFIRMATION_REQUIRED', reason, 'continue with an independent permitted action or ask the coordinator for risk confirmation'))
        continue
      }

      let result: string
      try {
        let effectId: string | undefined
        const execute = async () => {
          options.context?.signal?.throwIfAborted()
          if (tool.execute !== selectedExecutor || JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters }) !== selectedDescriptor) return formatToolError('conflict', 'TOOL_CONTRACT_CHANGED', 'Installed tool schema or executor changed during authorization; retry against its current contract.')
          const finalValidation = validateToolArguments(tool.parameters, args)
          if (!finalValidation.valid) return formatToolError('validation', 'INVALID_ARGUMENTS', finalValidation.errors.join('; '))
          if (gitVersion && (await captureGitMutationVersion(options.context!.workspacePath!, options.context?.signal)).digest !== gitVersion.digest) return formatToolError('conflict', 'WORKSPACE_CHANGED', 'Git workspace changed before worker execution; request authorization against the current checkout, index and configuration.')
          if (!isRetrySafeReadToolCall(call.function.name, finalValidation.value!)) {
            const markedEffect = await options.context?.markEffectStarted?.(call.function.name)
            effectId = typeof markedEffect === 'string' ? markedEffect : undefined
          }
          const callContext = effectId && childContext ? { ...childContext, effectId } : childContext
          return normalizeToolResult(await tool.execute(finalValidation.value!, callContext))
        }
        result = options.context?.session
          ? await options.context.session.executeJournaled(call.function.name, args, execute, options.context.taskId)
          : await execute()
      } catch (error) {
        if (error instanceof DurableExecutionError) throw error
        result = normalizeToolException(error)
      }
      result = pushToolResult(call.id, call.function.name, result)
      options.context?.emit?.('tool_finished', { tool: call.function.name, result: (redactSecrets(result) as string).slice(0, 200) })
    }
  }
}
