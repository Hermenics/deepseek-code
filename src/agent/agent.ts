import OpenAI from 'openai'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import DEFAULT_SYSTEM_PROMPT_MD from './system-prompt.md' with { type: 'text' }
import { allTools } from '../tools/index.js'
import { setShellConfirmHandler } from '../tools/Shell.js'
import { setSubAgentProvider, setSubAgentModel } from '../tools/SubAgent.js'
import { loadMcpTools } from './mcp.js'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'
import type { Model } from '../commands.js'
import type { AgentConfig } from './config.js'
import type { Tool } from '../tools/types.js'
import { resolveAgentFiles } from './files.js'
import { loadSteering } from './steering.js'
import { createLLMClient, defaultModel } from './llmClient.js'
import { listBedrockDeepSeekModels, modelSupportsChatCompletions } from './providers/bedrock.js'
import { listVertexDeepSeekModels } from './providers/vertex.js'
import { saveHistory } from './history.js'
import { saveCheckpoint, listCheckpoints, loadCheckpoint } from './checkpoint.js'
import { createBoundaryMarker, getMessagesAfterBoundary, isBoundaryMarker, type MessageOrBoundary } from './compactBoundary.js'
import { estimateCost, formatCost, getContextLimit, type TokenUsage } from './cost.js'
import type { ProviderConfig } from '../ui/setup/ApiKeySetup.js'
import { UNDO_STACK_MAX, CONTEXT_COMPACT_THRESHOLD } from '../constants.js'
import { auditLog } from './auditLog.js'
import { canUseTool, DEFAULT_MODE, getToolsForMode, type InteractionMode } from '../ui/interactionMode.js'

/** Workaround: OpenAI SDK has not typed reasoning_content yet (exclusive field of deepseek-reasoner) */
type AssistantMessageWithReasoning = ChatCompletionMessageParam & { reasoning_content?: string }

class DenyAbortError extends Error {
  constructor() { super('deny-abort') }
}

// Tools that are safe to run in parallel (read-only or isolated)
const PARALLEL_SAFE = new Set(['subagent', 'shell', 'grep', 'glob', 'read_file', 'read_folder', 'web_fetch', 'introspect'])

const DEFAULT_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT_MD

// ── Bedrock prompt-based tool calling ─────────────────────────────────────────
// DeepSeek R1 on Bedrock does not support native tool calling.
// We inject tool definitions into the system prompt and parse XML-style calls.

function buildBedrockToolsPrompt(tools: Tool[]): string {
  const defs = tools.map((t) => {
    const props = Object.entries((t.parameters as any)?.properties ?? {})
      .map(([k, v]: [string, any]) => `    - ${k} (${v.type ?? 'string'}): ${v.description ?? ''}`)
      .join('\n')
    const required = ((t.parameters as any)?.required ?? []).join(', ')
    return `<tool name="${t.name}">\n  <description>${t.description}</description>\n  <parameters>\n${props}\n  </parameters>\n  <required>${required}</required>\n</tool>`
  }).join('\n')

  return `\n\nYou have access to the following tools. To use a tool, respond with a <tool_call> block:\n\n<tool_call>\n<name>tool_name</name>\n<args>{"param": "value"}</args>\n</tool_call>\n\nAfter the tool runs, you will receive a <tool_result> block. You can call multiple tools sequentially. When you have the final answer, respond normally without a <tool_call> block.\n\nAvailable tools:\n${defs}`
}

interface ParsedToolCall {
  name: string
  args: Record<string, unknown>
  raw: string
}

function parseBedrockToolCalls(text: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = []
  const regex = /<tool_call>([\s\S]*?)<\/tool_call>/g
  let match
  while ((match = regex.exec(text)) !== null) {
    const inner = match[1]!
    const nameMatch = /<name>([\s\S]*?)<\/name>/.exec(inner)
    const argsMatch = /<args>([\s\S]*?)<\/args>/.exec(inner)
    if (!nameMatch) continue
    const name = nameMatch[1]!.trim()
    let args: Record<string, unknown> = {}
    if (argsMatch) {
      try { args = JSON.parse(argsMatch[1]!.trim()) } catch { }
    }
    calls.push({ name, args, raw: match[0] })
  }
  return calls
}

function stripToolCalls(text: string): string {
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    .replace(/<tool_result>[\s\S]*?<\/tool_result>/g, '')
    .replace(/<step>[\s\S]*?<\/step>/g, '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
    .replace(/<response>([\s\S]*?)<\/response>/g, '$1')
    .trim()
}

function extractThinking(text: string): string {
  const parts: string[] = []
  const regexes = [/<step>([\s\S]*?)<\/step>/g, /<think>([\s\S]*?)<\/think>/g, /<thinking>([\s\S]*?)<\/thinking>/g]
  for (const regex of regexes) {
    let match
    while ((match = regex.exec(text)) !== null) parts.push(match[1]!.trim())
  }
  return parts.join('\n')
}

function toOpenAITools(tools: Tool[]): ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown> },
  }))
}

export type ToolPermissionResult = 'once' | 'session' | 'deny'
export type ToolPermissionHandler = (toolName: string, args: object) => Promise<ToolPermissionResult>

export interface AgentCallbacks {
  onToken(text: string): void
  onThinking?(text: string): void
  onToolCall(name: string, args: object): void
  onToolResult(name: string, result: string, args: Record<string, unknown>): void
  onDone(): void
  onPhaseChange?(phase: 'refining' | 'executing'): void
  onAutoCompact?(summary: string): void
  onDenyAbort?(): void
}

interface UndoEntry {
  path: string
  content: string
}

export class Agent {
  private client: OpenAI
  private messages: MessageOrBoundary[] = [{ role: 'system', content: DEFAULT_SYSTEM_PROMPT }]
  private systemPrompt = DEFAULT_SYSTEM_PROMPT
  private tools: Tool[] = allTools
  private toolMap: Map<string, Tool> = new Map(allTools.map((t) => [t.name, t]))
  private openaiTools: ChatCompletionTool[] = toOpenAITools(allTools)
  private undoStack: UndoEntry[] = []
  private filesModified: Set<string> = new Set()
  private tokenUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 }
  private lastUserMessage: string | null = null
  private abortController: AbortController | null = null
  public readyPromise: Promise<void> = Promise.resolve()
  public mcpErrors: string[] = []
  public initErrors: string[] = []
  private sessionStartTime: number = Date.now()
  private toolCallTotal: number = 0

  public tokenCount = 0
  public model: Model = 'deepseek-v4-flash'
  public activeAgent: string | null = null
  public provider: ProviderConfig['provider'] = 'deepseek'
  private providerConfig: ProviderConfig = { provider: 'deepseek' }
  public contextUsage = 0      // last known prompt token count
  public contextLimit = 128_000
  private confirmHandler: ((message: string) => Promise<boolean>) | null = null
  private toolPermissionHandler: ToolPermissionHandler | null = null
  private sessionApprovedTools: Set<string> = new Set()
  private allowedTools: string[] | '*' | null = null
  public interactionMode: InteractionMode = DEFAULT_MODE

  setConfirmHandler(handler: ((message: string) => Promise<boolean>) | null) {
    this.confirmHandler = handler
    setShellConfirmHandler(handler)
  }

  setToolPermissionHandler(handler: ToolPermissionHandler | null) {
    this.toolPermissionHandler = handler
  }

  constructor(providerConfig?: ProviderConfig) {
    this.client = createLLMClient(providerConfig ?? { provider: 'deepseek' })
    if (providerConfig) {
      this.provider = providerConfig.provider
      this.providerConfig = providerConfig
      this.model = (providerConfig.provider === 'local' && providerConfig.localModel
        ? providerConfig.localModel
        : defaultModel(providerConfig.provider)) as Model
      // Propagate provider to SubAgent so it uses the same backend
      setSubAgentProvider(providerConfig)
      setSubAgentModel(this.model)
    }
    this.contextLimit = getContextLimit(this.provider, this.model)
    // Initialize async — readyPromise is awaited in run() to prevent race conditions
    this.readyPromise = this.initialize()
  }

  private async initialize(): Promise<void> {
    try {
      const [steering, deepseekMd, { tools: mcpTools, errors: mcpErrors }] = await Promise.all([
        loadSteering(),
        readFile(join(process.cwd(), 'DEEPSEEK.md'), 'utf-8').catch(() => ''),
        loadMcpTools(),
      ])
      this.mcpErrors = mcpErrors
      const parts: string[] = []
      if (steering) parts.push(steering)
      if (deepseekMd) parts.push(`--- DEEPSEEK.md ---\n${deepseekMd.trim()}`)
      if (parts.length) {
        this.systemPrompt = `${DEFAULT_SYSTEM_PROMPT}\n\n${parts.join('\n\n')}`
      }
      // Bedrock R1: inject tool definitions into system prompt (no native tool calling)
      // V3.2/V3.1 use bedrock-mantle which supports tools natively via Chat Completions
      if (this.provider === 'bedrock' && !modelSupportsChatCompletions(this.model)) {
        this.systemPrompt += buildBedrockToolsPrompt(this.tools)
      }
      this.messages = [{ role: 'system', content: this.systemPrompt }]
      if (mcpTools.length) {
        this.tools = [...allTools, ...mcpTools]
        this.toolMap = new Map(this.tools.map((t) => [t.name, t]))
        this.openaiTools = toOpenAITools(this.tools)
      }
    } catch (e) {
      // Fall back to defaults — agent still works without steering/history
      this.initErrors.push(`Init warning: ${(e as Error).message}`)
    }
  }

  // ── Abort ──────────────────────────────────────────────────────────────────

  abort() {
    this.abortController?.abort()
  }

  // ── Undo ───────────────────────────────────────────────────────────────────

  async undo(): Promise<string> {
    const entry = this.undoStack.pop()
    if (!entry) return 'Nothing to undo.'
    try {
      await writeFile(entry.path, entry.content, 'utf-8')
      return `Restored ${entry.path}`
    } catch (e) {
      return `Error restoring ${entry.path}: ${(e as Error).message}`
    }
  }

  // ── Files modified ─────────────────────────────────────────────────────────

  getFilesModified(): string[] {
    return [...this.filesModified]
  }

  getSystemPrompt(): string {
    return this.systemPrompt
  }

  getToolNames(): string[] {
    return this.tools.map((t) => t.name)
  }

  getPermissionsInfo(): { mode: InteractionMode; allowedTools: string[] | '*' | null; sessionApproved: string[]; modeTools: string[] } {
    return {
      mode: this.interactionMode,
      allowedTools: this.allowedTools,
      sessionApproved: [...this.sessionApprovedTools],
      modeTools: getToolsForMode(this.interactionMode),
    }
  }

  // ── Available models (dynamic) ──────────────────────────────────────────────

  async getAvailableModels(): Promise<string[]> {
    // Bedrock and Vertex: list only DeepSeek models via native SDK/API
    // (the /v1/models OpenAI-compat endpoint does not work for these providers)
    if (this.provider === 'bedrock') {
      const region  = this.providerConfig.awsRegion  ?? 'us-east-1'
      const profile = this.providerConfig.awsProfile ?? 'default'
      return listBedrockDeepSeekModels(region, profile)
    }

    if (this.provider === 'vertex') {
      const project     = this.providerConfig.gcpProject     ?? ''
      const location    = this.providerConfig.gcpLocation    ?? 'us-central1'
      const credentials = this.providerConfig.gcpCredentials ?? ''
      return listVertexDeepSeekModels(project, location, credentials)
    }

    // Native DeepSeek and local: use the standard /v1/models endpoint
    try {
      const res = await this.client.models.list({ signal: AbortSignal.timeout(10_000) })
      const models: string[] = []
      for await (const m of res) {
        models.push(m.id)
      }
      return models
    } catch {
      return []
    }
  }

  // ── Cost ───────────────────────────────────────────────────────────────────

  getCostSummary(): string {
    const cost = estimateCost(this.model, this.tokenUsage)
    return [
      `Model: ${this.model}`,
      `Tokens: ${this.tokenCount.toLocaleString()} total`,
      `  prompt: ${this.tokenUsage.promptTokens.toLocaleString()} (${this.tokenUsage.cachedTokens.toLocaleString()} cached)`,
      `  completion: ${this.tokenUsage.completionTokens.toLocaleString()}`,
      `Estimated cost: ${formatCost(cost)}`,
    ].join('\n')
  }

  getStats(): string {
    const elapsed = Date.now() - this.sessionStartTime
    const minutes = Math.floor(elapsed / 60_000)
    const seconds = Math.floor((elapsed % 60_000) / 1000)
    const duration = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
    const cost = estimateCost(this.model, this.tokenUsage)
    const userTurns = this.messages.filter((m) => !isBoundaryMarker(m) && (m as ChatCompletionMessageParam).role === 'user').length
    const cacheHitPct = this.tokenUsage.promptTokens > 0
      ? Math.round((this.tokenUsage.cachedTokens / this.tokenUsage.promptTokens) * 100)
      : 0
    return [
      `**Session Statistics**`,
      `Duration:       ${duration}`,
      `Model:          ${this.model}`,
      `Provider:       ${this.provider}`,
      ``,
      `**Tokens**`,
      `Total:          ${this.tokenCount.toLocaleString()}`,
      `Prompt:         ${this.tokenUsage.promptTokens.toLocaleString()} (${cacheHitPct}% cached)`,
      `Completion:     ${this.tokenUsage.completionTokens.toLocaleString()}`,
      ``,
      `**Activity**`,
      `User turns:     ${userTurns}`,
      `Tool calls:     ${this.toolCallTotal}`,
      `Files modified: ${this.filesModified.size}`,
      `Context usage:  ${this.contextUsage > 0 ? Math.round((this.contextUsage / this.contextLimit) * 100) + '%' : 'n/a'}`,
      ``,
      `**Cost**`,
      `Estimated:      ${formatCost(cost)}`,
    ].join('\n')
  }

  // ── Retry ──────────────────────────────────────────────────────────────────

  getLastUserMessage(): string | null {
    return this.lastUserMessage
  }

  // ── Checkpoint ─────────────────────────────────────────────────────────────

  async saveCheckpoint(label?: string): Promise<string> {
    const id = await saveCheckpoint(this.messages, [...this.filesModified], label)
    return id
  }

  async listCheckpoints() {
    return listCheckpoints()
  }

  async restoreCheckpoint(id: string): Promise<string> {
    const cp = await loadCheckpoint(id)
    if (!cp) return `Checkpoint ${id} not found.`
    this.messages = cp.messages
    await saveHistory(this.messages)
    return `Restored checkpoint from ${cp.label} (${cp.filesModified.length} files tracked)`
  }

  // ── Compact ────────────────────────────────────────────────────────────────

  async compact(): Promise<string> {
    const activeMessages = getMessagesAfterBoundary(this.messages)
    const nonSystem = activeMessages.filter((m) => m.role !== 'system')
    if (nonSystem.length === 0) return 'Nothing to compact.'
    const response = await this.withRetry(() =>
      this.client.chat.completions.create(
        {
          model: this.model,
          messages: [
            { role: 'system', content: 'Summarize the following conversation concisely, preserving all key decisions, code snippets, and context needed to continue the work.' },
            { role: 'user', content: nonSystem.map((m) => `[${m.role}]: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n\n') },
          ],
        },
        { signal: AbortSignal.timeout(30_000) },
      )
    )
    const summary = response.choices[0]?.message.content ?? '(no summary)'

    // Reset messages to system + boundary + summary — prunes old history to prevent unbounded growth
    const systemMsg = this.messages[0]!
    this.messages = [
      systemMsg,
      createBoundaryMarker(),
      { role: 'assistant', content: `[Compacted context]\n${summary}` },
    ]

    await saveHistory(this.messages)
    return summary
  }

  setModel(m: Model) {
    this.model = m
    this.contextLimit = getContextLimit(this.provider, m)
    setSubAgentModel(m)
  }

  setLanguage(language: string): void {
    const langInstruction = `\n\n# PREFERRED LANGUAGE\nAlways respond in ${language}. Do NOT switch languages based on what language the user writes in — always use ${language}.`
    if (this.systemPrompt.includes('# PREFERRED LANGUAGE')) {
      this.systemPrompt = this.systemPrompt.replace(/\n\n# PREFERRED LANGUAGE\n[\s\S]*$/, langInstruction)
    } else {
      this.systemPrompt = this.systemPrompt + langInstruction
    }
    this.messages = [{ role: 'system', content: this.systemPrompt }, ...this.messages.slice(1)]
  }

  clearHistory() {
    this.messages = [{ role: 'system', content: this.systemPrompt }]
    this.undoStack = []
    this.filesModified = new Set()
  }

  /**
   * Adds a background note that will be injected into the next agent turn
   * as a system-level context hint, without interrupting ongoing work.
   * Similar to /btw in Claude Code.
   */
  addNote(note: string): void {
    this.pendingNotes.push(note)
  }

  private pendingNotes: string[] = []

  getMessages(): ChatCompletionMessageParam[] {
    // Backward compatible — external consumers get clean messages without boundary markers
    return this.messages.filter(
      (m): m is ChatCompletionMessageParam => !isBoundaryMarker(m)
    )
  }

  /** Full history including compact boundary markers — used by session persistence */
  getRawMessages(): MessageOrBoundary[] {
    return this.messages
  }

  loadSessionMessages(messages: MessageOrBoundary[]): void {
    this.messages = messages
  }

  async applyAgentConfig(config: AgentConfig): Promise<void> {
    let prompt = config.systemPrompt
    if (config.files?.length) {
      const injected = await resolveAgentFiles(config.files)
      if (injected) prompt += `\n\n${injected}`
    }
    this.systemPrompt = prompt
    if (config.model) {
      this.model = config.model
      this.contextLimit = getContextLimit(this.provider, config.model)
      setSubAgentModel(config.model)
    }
    this.activeAgent = config.name
    this.allowedTools = config.allowedTools ?? null
    this.sessionApprovedTools = new Set()
    this.clearHistory()
  }

  resetAgent() {
    this.systemPrompt = DEFAULT_SYSTEM_PROMPT
    this.model = defaultModel(this.provider) as Model
    this.activeAgent = null
    this.allowedTools = null
    this.sessionApprovedTools = new Set()
    this.clearHistory()
  }

  async run(userMessage: string, cb: AgentCallbacks) {
    // Wait for async initialization to complete before running
    await this.readyPromise

    // Reset abort controller so a previous abort doesn't block the new run
    this.abortController = null

    // Auto-compact when context is above threshold
    if (this.contextUsage > 0 && this.contextUsage / this.contextLimit > CONTEXT_COMPACT_THRESHOLD) {
      try {
        const summary = await this.compact()
        auditLog({ type: 'compact', reason: 'context_threshold' })
        cb.onAutoCompact?.(summary)
      } catch (e) {
        auditLog({ type: 'compact_error', reason: String(e) })
        cb.onAutoCompact?.(`⚠ Auto-compact failed: ${(e as Error).message}. Use /compact manually.`)
      }
    }

    const now = new Date().toLocaleString()
    this.lastUserMessage = userMessage

    // Inject any pending /msg notes as a system-level context hint
    let messageContent = `[${now}]\n${userMessage}`
    if (this.pendingNotes.length > 0) {
      const notes = this.pendingNotes.map((n) => `• ${n}`).join('\n')
      messageContent += `\n\n[Background notes from user — context only, not a new task]\n${notes}`
      this.pendingNotes = []
    }

    cb.onPhaseChange?.('executing')
    this.messages.push({ role: 'user', content: messageContent })
    await this.loop(cb)
  }

  // ── Retry helper ───────────────────────────────────────────────────────────

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    const delays = [1000, 2000, 4000]
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        return await fn()
      } catch (e: unknown) {
        const err = e as { name?: string; status?: number }
        // Never retry aborts — check the signal directly, not the error name
        if (this.abortController?.signal.aborted) throw e
        // Retry on rate limit or server error
        if ((err.status === 429 || err.status === 503) && attempt < delays.length) {
          await new Promise((r) => setTimeout(r, delays[attempt]!))
          continue
        }
        throw e
      }
    }
    throw new Error('unreachable')
  }

  private async loop(cb: AgentCallbacks) {
    try {
      await this.runLoop(cb)
    } catch (e) {
      if (e instanceof DenyAbortError) {
        await saveHistory(this.messages)
        cb.onDenyAbort?.()
        cb.onDone()
        return
      }
      throw e
    }
  }

  private get useStreaming(): boolean {
    // Bedrock R1 (InvokeModel) and Vertex don't support streaming reliably
    // Bedrock V3.2/V3.1 via bedrock-mantle supports streaming
    if (this.provider === 'bedrock') return modelSupportsChatCompletions(this.model)
    return this.provider !== 'vertex'
  }

  private async runLoop(cb: AgentCallbacks) {
    while (true) {
      this.abortController = new AbortController()

      // Sanitize messages for the API: reasoning_content must be preserved for all models
      const rawMessages = getMessagesAfterBoundary(this.messages)
      const apiMessages = this.sanitizeMessagesForApi(rawMessages)

      // ── Non-streaming path for Bedrock/Vertex ──────────────────────────────
      if (!this.useStreaming) {
        let response: Awaited<ReturnType<typeof this.client.chat.completions.create>>
        try {
          response = await this.withRetry(() =>
            this.client.chat.completions.create(
              {
                model: this.model,
                messages: apiMessages,
                tools: this.openaiTools,
                max_tokens: 32768,
                stream: false,
              },
              { signal: this.abortController!.signal },
            )
          )
        } catch (e: unknown) {
          if (this.abortController?.signal.aborted) { cb.onDone(); return }
          throw e
        }

        const choice = (response as any).choices?.[0]
        if (!choice) { cb.onDone(); return }

        const msg = choice.message
        const rawText = msg?.content ?? ''
        const reasoningText = (msg as any)?.reasoning_content ?? ''

        // Track usage
        const usage = (response as any).usage
        if (usage) {
          this.tokenCount += usage.total_tokens ?? 0
          this.tokenUsage.promptTokens += usage.prompt_tokens ?? 0
          this.tokenUsage.completionTokens += usage.completion_tokens ?? 0
          this.tokenUsage.cachedTokens += usage.prompt_cache_hit_tokens ?? 0
          this.contextUsage = usage.prompt_tokens ?? 0
        }

        // ── Bedrock R1: prompt-based tool calling ────────────────────────────
        // V3.2/V3.1 use native tool calling via bedrock-mantle (falls through to native path below)
        if (this.provider === 'bedrock' && !modelSupportsChatCompletions(this.model)) {
          // Emit reasoning/thinking content
          const thinkingContent = reasoningText || extractThinking(rawText)
          if (thinkingContent) cb.onThinking?.(thinkingContent)

          const toolCalls = parseBedrockToolCalls(rawText)
          if (toolCalls.length > 0) {
            const visibleText = stripToolCalls(rawText)
            if (visibleText) cb.onToken(visibleText)
            // Store assistant message with raw text (includes tool_call blocks)
            const assistantMsg: AssistantMessageWithReasoning = { role: 'assistant', content: rawText }
            if (reasoningText) assistantMsg.reasoning_content = reasoningText
            this.messages.push(assistantMsg)

            // Execute each tool and append results as user messages
            for (const tc of toolCalls) {
              const fakeTc = { id: `bedrock-${Date.now()}`, type: 'function' as const, function: { name: tc.name, arguments: JSON.stringify(tc.args) } }
              if ((tc.name === 'write_file' || tc.name === 'patch_file') && tc.args.path) {
                const filePath = tc.args.path as string
                this.filesModified.add(filePath)
                try {
                  const oldContent = await readFile(filePath, 'utf-8')
                  this.undoStack.push({ path: filePath, content: oldContent })
                } catch {
                  this.undoStack.push({ path: filePath, content: '' })
                }
                if (this.undoStack.length > UNDO_STACK_MAX) this.undoStack.shift()
              }
              const { result } = await this.checkAndExecuteTool(fakeTc, tc.args, cb)
              this.messages.push({ role: 'user', content: `<tool_result>\n<name>${tc.name}</name>\n<result>${result}</result>\n</tool_result>` })
            }
            continue // next iteration — model will process tool results
          }
          // No tool calls — final response
          const assistantText = stripToolCalls(rawText)
          if (assistantText) cb.onToken(assistantText)
          const finalMsg: AssistantMessageWithReasoning = { role: 'assistant', content: rawText }
          if (reasoningText) finalMsg.reasoning_content = reasoningText
          this.messages.push(finalMsg)
          await saveHistory(this.messages)
          cb.onDone()
          return
        }

        // ── Native tool calling (non-Bedrock) ───────────────────────────────
        const assistantText = rawText
        if (assistantText) cb.onToken(assistantText)

        if (!msg?.tool_calls?.length) {
          const finalMsg: AssistantMessageWithReasoning = { role: 'assistant', content: assistantText }
          if (reasoningText) finalMsg.reasoning_content = reasoningText
          this.messages.push(finalMsg)
          await saveHistory(this.messages)
          cb.onDone()
          return
        }

        // Has tool calls
        const tcArray = msg.tool_calls.map((tc: any) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        }))
        const assistantMsg: AssistantMessageWithReasoning = {
          role: 'assistant',
          content: assistantText || null,
          tool_calls: tcArray,
        }
        if (reasoningText) assistantMsg.reasoning_content = reasoningText
        this.messages.push(assistantMsg)

        // Execute tools
        const parsedList = tcArray.map((tc: any) => {
          let parsedArgs: Record<string, unknown> = {}
          try { parsedArgs = JSON.parse(tc.function.arguments) } catch { }
          return { tc, parsedArgs }
        })

        for (const { tc, parsedArgs } of parsedList) {
          if ((tc.function.name === 'write_file' || tc.function.name === 'patch_file') && parsedArgs.path) {
            const filePath = parsedArgs.path as string
            this.filesModified.add(filePath)
            try {
              const oldContent = await readFile(filePath, 'utf-8')
              this.undoStack.push({ path: filePath, content: oldContent })
            } catch {
              this.undoStack.push({ path: filePath, content: '' })
            }
            if (this.undoStack.length > UNDO_STACK_MAX) this.undoStack.shift()
          }
        }

        for (const { tc, parsedArgs } of parsedList) {
          const { result } = await this.checkAndExecuteTool(tc, parsedArgs, cb)
          this.messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
        }
        continue // next iteration of the agent loop
      }

      // ── Streaming path (default for DeepSeek/local) ────────────────────────
      let stream: Awaited<ReturnType<typeof this.client.chat.completions.create>>
      try {
        stream = await this.withRetry(() =>
          this.client.chat.completions.create(
            {
              model: this.model,
              messages: apiMessages,
              tools: this.openaiTools,
              stream: true,
              stream_options: { include_usage: true },
            },
            { signal: this.abortController!.signal },
          )
        )
      } catch (e: unknown) {
        if (this.abortController?.signal.aborted) {
          cb.onDone()
          return
        }
        throw e
      }

      let assistantText = ''
      let reasoningText = ''
      const toolCalls: Map<number, { id: string; name: string; args: string }> = new Map()

      try {
        for await (const chunk of stream) {
          // Always capture usage when present — may arrive with empty choices OR alongside a delta
          if (chunk.usage) {
            this.tokenCount += chunk.usage.total_tokens
            this.tokenUsage.promptTokens += chunk.usage.prompt_tokens
            this.tokenUsage.completionTokens += chunk.usage.completion_tokens
            this.tokenUsage.cachedTokens += (chunk.usage as { prompt_cache_hit_tokens?: number }).prompt_cache_hit_tokens ?? 0
            this.contextUsage = chunk.usage.prompt_tokens
          }

          const delta = chunk.choices[0]?.delta
          if (!delta) continue

          // Cast required: OpenAI SDK has not typed reasoning_content in delta (exclusive field of deepseek-reasoner)
          const deltaReasoning = (delta as Record<string, unknown>).reasoning_content
          if (typeof deltaReasoning === 'string' && deltaReasoning) {
            reasoningText += deltaReasoning
            cb.onThinking?.(deltaReasoning)
          }

          if (delta.content) {
            assistantText += delta.content
            cb.onToken(delta.content)
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index
              if (!toolCalls.has(idx)) {
                toolCalls.set(idx, { id: tc.id || '', name: tc.function?.name || '', args: '' })
              }
              const entry = toolCalls.get(idx)!
              if (tc.id) entry.id = tc.id
              if (tc.function?.name) entry.name = tc.function.name
              if (tc.function?.arguments) entry.args += tc.function.arguments
            }
          }
        }
      } catch (e: unknown) {
        if (this.abortController?.signal.aborted) {
          if (assistantText || reasoningText) {
            const abortMsg: AssistantMessageWithReasoning = { role: 'assistant', content: assistantText || null }
            // Always preserve reasoning_content — DeepSeek-V4-Flash has built-in thinking mode
            // and the API requires the field to be passed back when present
            if (reasoningText) abortMsg.reasoning_content = reasoningText
            this.messages.push(abortMsg)
          }
          await saveHistory(this.messages)
          cb.onDone()
          return
        }
        throw e
      }

      if (toolCalls.size === 0) {
        const finalMsg: AssistantMessageWithReasoning = { role: 'assistant', content: assistantText }
        // Always preserve reasoning_content — DeepSeek-V4-Flash has built-in thinking mode
        if (reasoningText) finalMsg.reasoning_content = reasoningText
        this.messages.push(finalMsg)
        await saveHistory(this.messages)
        cb.onDone()
        return
      }

      const tcArray = [...toolCalls.values()].map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.args },
      }))
      const assistantMsg: AssistantMessageWithReasoning = {
        role: 'assistant',
        content: assistantText || null,
        tool_calls: tcArray,
      }
      // Always preserve reasoning_content — DeepSeek-V4-Flash has built-in thinking mode
      if (reasoningText) assistantMsg.reasoning_content = reasoningText
      this.messages.push(assistantMsg)

      // ── Parse all args first ───────────────────────────────────────────────
      const parsedList = tcArray.map((tc) => {
        let parsedArgs: Record<string, unknown> = {}
        try { parsedArgs = JSON.parse(tc.function.arguments) } catch { }
        return { tc, parsedArgs }
      })

      // ── Undo snapshots for file writes (always sequential) ─────────────────
      for (const { tc, parsedArgs } of parsedList) {
        if ((tc.function.name === 'write_file' || tc.function.name === 'patch_file') && parsedArgs.path) {
          const filePath = parsedArgs.path as string
          this.filesModified.add(filePath)
          try {
            const oldContent = await readFile(filePath, 'utf-8')
            this.undoStack.push({ path: filePath, content: oldContent })
          } catch {
            this.undoStack.push({ path: filePath, content: '' })
          }
          // Keep stack bounded
          if (this.undoStack.length > UNDO_STACK_MAX) this.undoStack.shift()
        }
      }

      // ── Partition: parallel-safe vs sequential ─────────────────────────────
      const canParallelize = parsedList.every(({ tc }) => PARALLEL_SAFE.has(tc.function.name))

      if (canParallelize && parsedList.length > 1) {
        // Run all tool calls concurrently — use allSettled so a deny doesn't
        // silently abandon already-running tools without recording their results
        const settled = await Promise.allSettled(
          parsedList.map(({ tc, parsedArgs }) => this.checkAndExecuteTool(tc, parsedArgs, cb))
        )
        for (const s of settled) {
          if (s.status === 'fulfilled') {
            this.messages.push({ role: 'tool', tool_call_id: s.value.tc.id, content: s.value.result })
          }
        }
        // Propagate DenyAbortError after collecting fulfilled results
        const denied = settled.find((s) => s.status === 'rejected' && s.reason instanceof DenyAbortError)
        if (denied) throw new DenyAbortError()
      } else {
        // Sequential execution (file writes, or mixed batch)
        for (const { tc, parsedArgs } of parsedList) {
          const { result } = await this.checkAndExecuteTool(tc, parsedArgs, cb)
          this.messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
        }
      }
    }
  }

  /** Unified tool execution: mode check → permission check → audit → execute */
  private async checkAndExecuteTool(
    tc: { id: string; type: 'function'; function: { name: string; arguments: string } },
    parsedArgs: Record<string, unknown>,
    cb: AgentCallbacks,
  ): Promise<{ tc: typeof tc; result: string }> {
    // ── Interaction mode restriction ──────────────────────────────────────────
    if (!canUseTool(this.interactionMode, tc.function.name)) {
      const blockMsg = `Tool '${tc.function.name}' is not available in ${this.interactionMode} mode. Switch to Agent mode to use this tool.`
      auditLog({ type: 'tool_call', tool: tc.function.name, args: { ...parsedArgs, __blocked_by_mode: this.interactionMode } })
      cb.onToolCall(tc.function.name, parsedArgs)
      cb.onToolResult(tc.function.name, blockMsg, parsedArgs)
      return { tc, result: blockMsg }
    }

    // ── Tool permission check ─────────────────────────────────────────────────
    // allowedTools === '*'  → all tools require permission
    // allowedTools = string[] → only listed tools require permission
    // allowedTools === null  → no permission prompts (default)
    const needsPermission = this.allowedTools !== null && (
      this.allowedTools === '*' ||
      (Array.isArray(this.allowedTools) && this.allowedTools.includes(tc.function.name))
    )
    if (needsPermission && !this.sessionApprovedTools.has(tc.function.name) && this.toolPermissionHandler) {
      const decision = await this.toolPermissionHandler(tc.function.name, parsedArgs)
      if (decision === 'deny') {
        auditLog({ type: 'tool_call', tool: tc.function.name, args: { ...parsedArgs, __denied: true } })
        throw new DenyAbortError()
      }
      if (decision === 'session') {
        this.sessionApprovedTools.add(tc.function.name)
      }
    }

    cb.onToolCall(tc.function.name, parsedArgs)
    auditLog({ type: 'tool_call', tool: tc.function.name, args: parsedArgs })
    this.toolCallTotal++
    const t0 = Date.now()
    const result = await this.executeTool(tc.function.name, parsedArgs)
    auditLog({ type: 'tool_result', tool: tc.function.name, result: result.slice(0, 200), durationMs: Date.now() - t0 })
    cb.onToolResult(tc.function.name, result, parsedArgs)
    return { tc, result }
  }

  /**
   * Sanitizes messages before sending to the API.
   *
   * DeepSeek-V4-Flash has built-in thinking mode and may return reasoning_content
   * on any model. When returned, the API REQUIRES it to be passed back.
   * Therefore: we always preserve reasoning_content in history and in the API.
   */
  private sanitizeMessagesForApi(
    messages: ChatCompletionMessageParam[]
  ): ChatCompletionMessageParam[] {
    // Pass everything as-is — reasoning_content must be preserved for all models
    return messages
  }

  private async executeTool(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.toolMap.get(name)
    if (!tool) return `Unknown tool: ${name}`
    try {
      return await tool.execute(args)
    } catch (e: unknown) {
      return `Error: ${(e as Error).message}`
    }
  }
}
