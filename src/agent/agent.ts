import OpenAI from 'openai'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'fs/promises'
import DEFAULT_SYSTEM_PROMPT_MD from './system-prompt.md' with { type: 'text' }
import { allTools } from '../tools/index.js'
import { setShellConfirmHandler } from '../tools/Shell/Shell.js'
import { setSubAgentProvider, setSubAgentModel } from '../tools/SubAgent/SubAgent.js'
import { setAgentNoteCallback, setAskAgentProvider, setAskAgentModel } from '../tools/AskAgent/AskAgent.js'
import { resetMemory } from '../tools/SubAgent/memory.js'
import { loadMcpTools } from './mcp.js'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'
import type { Model } from '../commands.js'
import type { AgentConfig } from './config.js'
import type { Tool } from '../tools/types.js'
import { resolveAgentFiles } from './files.js'
import { loadSteering, loadDeepSeekMd } from './steering.js'
import { getMemorySnapshot, addEntry } from './memory.js'
import { loadMergedSettings } from '../settings/index.js'
import type { DeepSeekSettings } from '../settings/types.js'
import type { EffortLevel } from '../commands/types.js'
import { createLLMClient, defaultModel } from './llmClient.js'
import { listBedrockDeepSeekModels, modelSupportsChatCompletions } from './providers/bedrock.js'
import { listVertexDeepSeekModels } from './providers/vertex.js'
import { saveHistory } from './history.js'
import { saveCheckpoint, listCheckpoints, loadCheckpoint } from './checkpoint.js'
import { createFileCheckpoint, setCheckpointSession, rollbackAll as fileRollbackAll, listFileCheckpoints } from './fileCheckpoint.js'
import { createBoundaryMarker, getMessagesAfterBoundary, isBoundaryMarker, type MessageOrBoundary } from './compactBoundary.js'
import { estimateCost, formatCost, getContextLimit, type TokenUsage } from './cost.js'
import type { ProviderConfig } from '../types/provider.js'
import { UNDO_STACK_MAX, CONTEXT_COMPACT_THRESHOLD, MICRO_COMPACT_KEEP_LAST } from '../constants.js'
import { shouldAutoCompact, microCompact, createCompactState, createAutoCompactConfig, type CompactState, type AutoCompactConfig } from '../services/compact/autoCompact.js'
import { COMPACT_SUMMARY_PROMPT, COMPACT_SYSTEM_PROMPT } from '../services/compact/summaryPrompt.js'
import { auditLog } from './auditLog.js'
import { refinePrompt } from './promptRefiner.js'
import { canUseTool, DEFAULT_MODE, getToolsForMode, isBuildMode, isAutoMode, type InteractionMode } from '../ui/interactionMode.js'
import { resolvePermission } from '../permissions/index.js'
import { assessRisk } from '../permissions/risk.js'
import { runPreToolHooks, runPostToolHooks, runSessionStartHooks } from '../hooks/index.js'
import type { HooksConfig } from '../hooks/types.js'

/** Workaround: OpenAI SDK has not typed reasoning_content yet (exclusive field of deepseek-reasoner) */
type AssistantMessageWithReasoning = ChatCompletionMessageParam & { reasoning_content?: string }

class DenyAbortError extends Error {
  constructor() { super('deny-abort') }
}

// Tools that are safe to run in parallel (read-only or isolated)
const PARALLEL_SAFE = new Set(['subagent', 'ask_agent', 'shell', 'grep', 'glob', 'read_file', 'read_folder', 'web_fetch', 'introspect'])

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

interface ToolValidationResult {
  valid: boolean
  error?: string
}

function validateToolArguments(tool: Tool, args: Record<string, unknown>): ToolValidationResult {
  const params = (tool.parameters as {
    properties?: Record<string, unknown>
    required?: string[]
  }) ?? {}

  const properties = params.properties ?? {}
  const validKeys = new Set(Object.keys(properties))
  const required = params.required ?? []

  // If no properties are defined, skip extra-key validation (schema is open)
  const extra = validKeys.size > 0
    ? Object.keys(args).filter((key) => !validKeys.has(key))
    : []
  const missing = required.filter((key) => args[key] === undefined)

  if (extra.length === 0 && missing.length === 0) return { valid: true }

  const lines: string[] = [`[Tool Error: ${tool.name}]`, 'Invalid arguments:']

  for (const key of extra) {
    lines.push(`- "${key}" is not a valid parameter for this tool`)
  }

  for (const key of missing) {
    lines.push(`- missing required parameter "${key}"`)
  }

  const validParams = Object.keys(properties)
    .map((key) => `${key}${required.includes(key) ? ' (required)' : ''}`)
    .join(', ')

  lines.push(`Valid parameters: ${validParams || '(none)'}`)

  return { valid: false, error: lines.join('\n') }
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

interface PendingNote {
  source: 'user' | 'agent'
  agentName?: string
  text: string
}

export type ToolPermissionResult = 'once' | 'session' | 'always' | 'deny'
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
  private readonly hookSessionId = randomUUID()

  public tokenCount = 0
  public model: Model = 'deepseek-v4-flash'
  public activeAgent: string | null = null
  public provider: ProviderConfig['provider'] = 'deepseek'
  private providerConfig: ProviderConfig = { provider: 'deepseek' }
  public contextUsage = 0      // last known prompt token count
  public contextLimit = 1_000_000
  private toolPermissionHandler: ToolPermissionHandler | null = null
  private sessionApprovedTools: Set<string> = new Set()
  private turnWriteCount = 0
  private allowedTools: string[] | '*' | null = null
  public interactionMode: InteractionMode = DEFAULT_MODE
  public effortLevel: EffortLevel = 'high'
  public settings: DeepSeekSettings = {}
  private compactState: CompactState = createCompactState()
  private autoCompactConfig: AutoCompactConfig = createAutoCompactConfig({}, CONTEXT_COMPACT_THRESHOLD)

  setConfirmHandler(handler: ((message: string) => Promise<boolean>) | null) {
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
      setAskAgentProvider(providerConfig)
      setAskAgentModel(this.model)
    }
    // Always wire the note callback so ask_agent responses route to this instance
    setAgentNoteCallback((agentName, text) => this.addAgentNote(agentName, text))
    this.contextLimit = getContextLimit(this.provider, this.model)
    setCheckpointSession(this.hookSessionId)
    // Initialize async — readyPromise is awaited in run() to prevent race conditions
    this.readyPromise = this.initialize()
  }

  private async initialize(): Promise<void> {
    try {
      const [steering, deepseekMd, settings, { tools: mcpTools, errors: mcpErrors }] = await Promise.all([
        loadSteering(),
        loadDeepSeekMd(),
        loadMergedSettings(),
        loadMcpTools(),
      ])
      this.mcpErrors = mcpErrors
      this.settings = settings
      this.autoCompactConfig = createAutoCompactConfig(settings, CONTEXT_COMPACT_THRESHOLD)

      // Apply settings overrides
      if (settings.model && !this.providerConfig.localModel) {
        this.model = settings.model as Model
        this.contextLimit = getContextLimit(this.provider, this.model)
      }

      const parts: string[] = []
      if (steering) parts.push(steering)
      if (deepseekMd) parts.push(`--- DEEPSEEK.md ---\n${deepseekMd}`)

      const memorySnapshot = await getMemorySnapshot()
      if (memorySnapshot) parts.push(`--- MEMORY ---\n${memorySnapshot}`)
      if (parts.length) {
        const basePrompt = DEFAULT_SYSTEM_PROMPT
        this.systemPrompt = `${basePrompt}\n\n${parts.join('\n\n')}`
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

      // Run SessionStart hooks
      if (this.settings.hooks) {
        await runSessionStartHooks(this.settings.hooks as HooksConfig, this.hookSessionId)
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

  async undoAll(): Promise<string> {
    return fileRollbackAll(this.hookSessionId)
  }

  async undoList(): Promise<string> {
    const entries = await listFileCheckpoints(this.hookSessionId)
    if (entries.length === 0) return 'No file checkpoints in this session.'
    return entries
      .map((e) => `  ${e.id}  ${e.path}  (${e.toolName})`)
      .join('\n')
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

  getPermissionsInfo(): { mode: InteractionMode; allowedTools: string[] | '*' | null; sessionApproved: string[]; modeTools: string[]; permissions: DeepSeekSettings['permissions']; risk: DeepSeekSettings['risk'] } {
    return {
      mode: this.interactionMode,
      allowedTools: this.allowedTools,
      sessionApproved: [...this.sessionApprovedTools],
      modeTools: getToolsForMode(this.interactionMode),
      permissions: this.settings.permissions,
      risk: this.settings.risk,
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
            { role: 'system', content: COMPACT_SYSTEM_PROMPT },
            { role: 'user', content: `${COMPACT_SUMMARY_PROMPT}\n\n---\n\nConversation to summarize:\n\n${nonSystem.map((m) => `[${m.role}]: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n\n')}` },
          ],
          max_tokens: 4000,
        },
        { signal: AbortSignal.timeout(60_000) },
      )
    )
    const summary = response.choices[0]?.message.content ?? '(no summary)'

    // Reset messages to system + boundary + summary
    const systemMsg = this.messages[0]!
    this.messages = [
      systemMsg,
      createBoundaryMarker(),
      { role: 'assistant', content: `[Compacted context]\n${summary}` },
    ]

    // Post-compact refresh: re-inject DEEPSEEK.md context
    try {
      const deepseekMd = await loadDeepSeekMd()
      if (deepseekMd) {
        this.messages.push({
          role: 'user',
          content: `[System: Project instructions refreshed after compact]\n\n${deepseekMd}`,
        })
      }
    } catch { /* non-critical */ }

    await saveHistory(this.messages)
    return summary
  }

  setModel(m: Model) {
    this.model = m
    this.contextLimit = getContextLimit(this.provider, m)
    setSubAgentModel(m)
    setAskAgentModel(m)
  }

  setEffortLevel(level: EffortLevel): void {
    this.effortLevel = level
    this.rebuildSystemPromptEffort()
  }

  get promptRefinerEnabled(): boolean {
    return this.settings.promptRefiner?.enabled !== false
  }

  setPromptRefinerEnabled(enabled: boolean): void {
    if (!this.settings.promptRefiner) {
      this.settings.promptRefiner = {}
    }
    this.settings.promptRefiner.enabled = enabled
  }

  private rebuildSystemPromptEffort(): void {
    // Strip any existing effort hint
    this.systemPrompt = this.systemPrompt.replace(/\n\n# EFFORT LEVEL\n[\s\S]*?(?=\n\n#|$)/, '')
    // Append new hint (skip for 'high' — it's the default behavior)
    const hint = this.getEffortHint()
    if (hint) {
      this.systemPrompt += `\n\n# EFFORT LEVEL\n${hint}`
    }
    this.messages = [{ role: 'system', content: this.systemPrompt }, ...this.messages.slice(1)]
  }

  private getEffortHint(): string | null {
    switch (this.effortLevel) {
      case 'low': return 'Be concise and quick. Skip detailed explanations. Give the shortest correct answer.'
      case 'high': return 'Be thorough and comprehensive. Think step by step.'
      case 'max': return 'Use your deepest reasoning. Think extensively before responding. Consider all edge cases, alternative approaches, and potential issues.'
    }
  }

  /** Returns extra API params for DeepSeek V4 thinking mode control based on effortLevel */
  private getEffortApiParams(): Record<string, unknown> {
    // Only DeepSeek V4 models support thinking control
    if (this.provider !== 'deepseek' && this.provider !== 'bedrock') {
      return {}
    }
    if (this.effortLevel === 'low') {
      return { thinking: { type: 'disabled' } }
    }
    if (this.effortLevel === 'max') {
      return { reasoning_effort: 'max', thinking: { type: 'enabled' } }
    }
    // high: thinking enabled, default effort (high)
    return { reasoning_effort: 'high', thinking: { type: 'enabled' } }
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
    this.pendingNotes.push({ source: 'user', text: note })
  }

  addAgentNote(agentName: string, text: string): void {
    this.pendingNotes.push({ source: 'agent', agentName, text })
  }

  private pendingNotes: PendingNote[] = []

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
    // Reset subagent task memory at the start of each user turn
    resetMemory()
    this.turnWriteCount = 0

    // Wait for async initialization to complete before running
    await this.readyPromise

    // Reset abort controller so a previous abort doesn't block the new run
    this.abortController = null

    // MicroCompact: clear old tool results before checking threshold
    this.messages = microCompact(this.messages, MICRO_COMPACT_KEEP_LAST) as MessageOrBoundary[]

    // Auto-compact when context is above threshold (with circuit breaker)
    if (shouldAutoCompact(this.contextUsage, this.contextLimit, this.autoCompactConfig, this.compactState)) {
      try {
        const summary = await this.compact()
        this.compactState.consecutiveFailures = 0
        this.compactState.lastCompactTimestamp = Date.now()
        auditLog({ type: 'compact', reason: 'context_threshold' })
        cb.onAutoCompact?.(summary)
      } catch (e) {
        this.compactState.consecutiveFailures++
        auditLog({ type: 'compact_error', reason: String(e) })
        if (this.compactState.consecutiveFailures >= this.autoCompactConfig.maxConsecutiveFailures) {
          cb.onAutoCompact?.(`⚠ Auto-compact disabled after ${this.compactState.consecutiveFailures} failures. Use /compact manually.`)
        }
      }
    }

    const now = new Date().toLocaleString()
    this.lastUserMessage = userMessage

    // Prompt refinement (if enabled)
    let effectiveMessage = userMessage
    if (this.settings.promptRefiner?.enabled !== false && userMessage.length >= 30 && !userMessage.startsWith('/')) {
      cb.onPhaseChange?.('refining')
      effectiveMessage = await refinePrompt(this.client, this.model, userMessage)
    }

    // Inject any pending /msg notes as a system-level context hint
    let messageContent = `[${now}]\n${effectiveMessage}`
    if (this.pendingNotes.length > 0) {
      const userNotes = this.pendingNotes.filter(n => n.source === 'user')
      const agentNotes = this.pendingNotes.filter(n => n.source === 'agent')
      if (userNotes.length > 0) {
        messageContent += `\n\n[Background notes from user — context only, not a new task]\n${userNotes.map(n => `• ${n.text}`).join('\n')}`
      }
      if (agentNotes.length > 0) {
        messageContent += `\n\n[Async agent responses — informational, not a new task]\n${agentNotes.map(n => `• @${n.agentName}: ${n.text}`).join('\n')}`
      }
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
    const MAX_AGENT_ITERATIONS = 100
    let iterations = 0
    while (true) {
      if (++iterations > MAX_AGENT_ITERATIONS) {
        this.messages.push({ role: 'assistant', content: '⚠ Agent reached maximum iteration limit (100). Stopping to prevent infinite loop.' })
        break
      }

      this.abortController = new AbortController()

      // Sanitize messages for the API: reasoning_content must be preserved for all models
      const rawMessages = getMessagesAfterBoundary(this.messages)
      const apiMessages = this.sanitizeMessagesForApi(rawMessages)

      // ── Non-streaming path for Bedrock/Vertex ──────────────────────────────
      if (!this.useStreaming) {
        let response: Awaited<ReturnType<typeof this.client.chat.completions.create>>
        try {
          const effortParams = this.getEffortApiParams()
          response = await this.withRetry(() =>
            this.client.chat.completions.create(
              {
                model: this.model,
                messages: apiMessages,
                tools: this.openaiTools,
                max_tokens: 32768,
                stream: false,
                ...effortParams,
              } as any,
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
              const fakeTc = { id: `bedrock-${randomUUID().slice(0, 8)}`, type: 'function' as const, function: { name: tc.name, arguments: JSON.stringify(tc.args) } }
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
          this.syncTurn()
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
          this.syncTurn()
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
          const { result } = await this.checkAndExecuteTool(tc, parsedArgs, cb)
          this.messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
        }
        continue // next iteration of the agent loop
      }

      // ── Streaming path (default for DeepSeek/local) ────────────────────────
      let stream: AsyncIterable<any>
      try {
        const effortParams = this.getEffortApiParams()
        stream = await this.withRetry(() =>
          this.client.chat.completions.create({
            model: this.model,
            messages: apiMessages,
            tools: this.openaiTools,
            stream: true,
            stream_options: { include_usage: true },
            ...effortParams,
          } as any, { signal: this.abortController!.signal }) as any
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
          // Proxy error chunk: { error: { message: '...' } } — treat as recoverable, surface to user
          const chunkAny = chunk as any
          if (chunkAny.error?.message) {
            const errMsg = chunkAny.error.message as string
            cb.onToken(`⚠ Proxy error: ${errMsg}`)
            const errMsgObj: AssistantMessageWithReasoning = { role: 'assistant', content: `⚠ Proxy error: ${errMsg}` }
            this.messages.push(errMsgObj)
            await saveHistory(this.messages)
            cb.onDone()
            return
          }

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

      // Post-response compact check: trigger immediately when threshold crossed mid-turn
      if (this.contextUsage > 0 && this.contextLimit > 0) {
        const usageRatio = this.contextUsage / this.contextLimit
        if (usageRatio >= CONTEXT_COMPACT_THRESHOLD && this.compactState.consecutiveFailures < this.autoCompactConfig.maxConsecutiveFailures) {
          try {
            const summary = await this.compact()
            this.compactState.consecutiveFailures = 0
            this.compactState.lastCompactTimestamp = Date.now()
            auditLog({ type: 'compact', reason: 'mid_turn_threshold' })
            cb.onAutoCompact?.(summary)
          } catch (e) {
            this.compactState.consecutiveFailures++
            auditLog({ type: 'compact_error', reason: String(e) })
          }
        }
      }

      if (toolCalls.size === 0) {
        const finalMsg: AssistantMessageWithReasoning = { role: 'assistant', content: assistantText }
        // Always preserve reasoning_content — DeepSeek-V4-Flash has built-in thinking mode
        if (reasoningText) finalMsg.reasoning_content = reasoningText
        this.messages.push(finalMsg)
        await saveHistory(this.messages)
        this.syncTurn()
        cb.onDone()
        return
      }

      let tcArray = [...toolCalls.values()].map((tc) => ({
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

      // ── Partition: parallel-safe vs sequential ─────────────────────────────
      const canParallelize = parsedList.every(({ tc }) => PARALLEL_SAFE.has(tc.function.name))

      if (canParallelize && parsedList.length > 1) {
        // Run all tool calls concurrently — use allSettled so a deny doesn't
        // silently abandon already-running tools without recording their results
        const settled = await Promise.allSettled(
          parsedList.map(({ tc, parsedArgs }) => this.checkAndExecuteTool(tc, parsedArgs, cb))
        )
        let hasDeny = false
        for (let idx = 0; idx < settled.length; idx++) {
          const s = settled[idx]!
          const tcId = parsedList[idx]!.tc.id
          if (s.status === 'fulfilled') {
            this.messages.push({ role: 'tool', tool_call_id: s.value.tc.id, content: s.value.result })
          } else {
            // Fill rejected/denied entries with a placeholder so API stays consistent
            this.messages.push({ role: 'tool', tool_call_id: tcId, content: '[tool call cancelled by user]' })
            if (s.reason instanceof DenyAbortError) hasDeny = true
          }
        }
        if (hasDeny) throw new DenyAbortError()
      } else {
        // Sequential execution (file writes, or mixed batch)
        for (const { tc, parsedArgs } of parsedList) {
          const { result } = await this.checkAndExecuteTool(tc, parsedArgs, cb)
          this.messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
        }
      }

    }
  }

  /** Unified tool execution: mode check → permission rules → legacy permission → audit → execute */
  private async checkAndExecuteTool(
    tc: { id: string; type: 'function'; function: { name: string; arguments: string } },
    parsedArgs: Record<string, unknown>,
    cb: AgentCallbacks,
  ): Promise<{ tc: typeof tc; result: string }> {
    // ── 0. Auto mode: bypass ALL permission checks ─────────────────────────
    if (isAutoMode(this.interactionMode)) {
      // Auto mode = zero restrictions. Skip mode check, permission rules, everything.
      // Jump straight to hooks + execution.
    } else {
    // ── 1. Interaction mode restriction ──────────────────────────────────────
    if (!canUseTool(this.interactionMode, tc.function.name)) {
      const blockMsg = `Tool '${tc.function.name}' is not available in ${this.interactionMode} mode. Switch to Build mode to use this tool.`
      auditLog({ type: 'tool_call', tool: tc.function.name, args: { ...parsedArgs, __blocked_by_mode: this.interactionMode } })
      cb.onToolCall(tc.function.name, parsedArgs)
      cb.onToolResult(tc.function.name, blockMsg, parsedArgs)
      return { tc, result: blockMsg }
    }

    // ── 1.5. Risk-level assessment (Build mode only) ─────────────────────────
    if (isBuildMode(this.interactionMode)) {
      // Track write count for burst detection
      if (tc.function.name === 'write_file' || tc.function.name === 'patch_file') {
        this.turnWriteCount++
      }

      const riskResult = assessRisk(tc.function.name, parsedArgs, {
        isSubAgent: false,
        recentWriteCount: this.turnWriteCount,
        config: this.settings.risk ?? {},
      })

      if (riskResult?.requiresConfirmation) {
        // Include actual command/path content in the session key to prevent over-broad approval
        const riskContentKey = tc.function.name === 'shell'
          ? (parsedArgs.command as string ?? '')
          : (parsedArgs.path as string ?? '')
        const riskSessionKey = `risk:${riskResult.matchedRule}:${riskContentKey}`

        if (!this.sessionApprovedTools.has(riskSessionKey)) {
          if (!this.toolPermissionHandler) {
            const blockMsg = `⚠️ Tool '${tc.function.name}' requer confirmação (${riskResult.level} risk: ${riskResult.description}). Sem handler de confirmação disponível.`
            cb.onToolCall(tc.function.name, parsedArgs)
            cb.onToolResult(tc.function.name, blockMsg, parsedArgs)
            return { tc, result: blockMsg }
          }
          const userDecision = await this.toolPermissionHandler(tc.function.name, parsedArgs)
          if (userDecision === 'deny') {
            auditLog({ type: 'tool_call', tool: tc.function.name, args: { ...parsedArgs, __denied_risk: riskResult.level } })
            throw new DenyAbortError()
          }
          if (userDecision === 'session') {
            this.sessionApprovedTools.add(riskSessionKey)
          }
        }
      }
    }

    // ── 2. Permission rules from settings (skip in build mode — auto-accept behavior) ─────────
    if (!isBuildMode(this.interactionMode)) {
      const ruleDecision = resolvePermission(this.settings.permissions, tc.function.name, parsedArgs)
      if (ruleDecision === 'deny') {
        const blockMsg = `Tool '${tc.function.name}' blocked by permission rule.`
        auditLog({ type: 'tool_call', tool: tc.function.name, args: { ...parsedArgs, __denied_by_rule: true } })
        cb.onToolCall(tc.function.name, parsedArgs)
        cb.onToolResult(tc.function.name, blockMsg, parsedArgs)
        return { tc, result: blockMsg }
      }
      if (ruleDecision === 'ask' && !this.sessionApprovedTools.has(tc.function.name) && this.toolPermissionHandler) {
        const userDecision = await this.toolPermissionHandler(tc.function.name, parsedArgs)
        if (userDecision === 'deny') {
          auditLog({ type: 'tool_call', tool: tc.function.name, args: { ...parsedArgs, __denied: true } })
          throw new DenyAbortError()
        }
        if (userDecision === 'session') {
          this.sessionApprovedTools.add(tc.function.name)
        }
        if (userDecision === 'always') {
          this.sessionApprovedTools.add(tc.function.name)
          const { saveUserSettings } = await import('../settings/writer.js')
          const currentAllow = this.settings.permissions?.allow ?? []
          if (!currentAllow.includes(tc.function.name)) {
            const newAllow = [...currentAllow, tc.function.name]
            await saveUserSettings({ permissions: { allow: newAllow } })
            // Keep in-memory settings in sync with disk
            if (!this.settings.permissions) this.settings.permissions = {}
            this.settings.permissions.allow = newAllow
          }
        }
      }
    }

    // ── 3. Legacy allowedTools check (agent-config level) ────────────────────
    if (this.allowedTools !== null && this.allowedTools !== '*') {
      // Array whitelist: block tools not in the list
      if (Array.isArray(this.allowedTools) && !this.allowedTools.includes(tc.function.name)) {
        const blockMsg = `Tool '${tc.function.name}' is not allowed by the current agent configuration.`
        auditLog({ type: 'tool_call', tool: tc.function.name, args: { ...parsedArgs, __blocked_by_allowlist: true } })
        cb.onToolCall(tc.function.name, parsedArgs)
        cb.onToolResult(tc.function.name, blockMsg, parsedArgs)
        return { tc, result: blockMsg }
      }
    }
    // allowedTools === '*' means all tools require permission confirmation
    if (this.allowedTools === '*' && !this.sessionApprovedTools.has(tc.function.name) && this.toolPermissionHandler) {
      const decision = await this.toolPermissionHandler(tc.function.name, parsedArgs)
      if (decision === 'deny') {
        auditLog({ type: 'tool_call', tool: tc.function.name, args: { ...parsedArgs, __denied: true } })
        throw new DenyAbortError()
      }
      if (decision === 'session') {
        this.sessionApprovedTools.add(tc.function.name)
      }
    }
    } // end of: } else { (non-auto permission checks)

    // ── 3.5. PreToolUse hooks ────────────────────────────────────────────────
    let effectiveArgs = parsedArgs
    if (this.settings.hooks) {
      const hookResult = await runPreToolHooks(
        this.settings.hooks as HooksConfig,
        tc.function.name,
        parsedArgs,
        this.hookSessionId,
      )
      if (hookResult.decision === 'block') {
        const blockMsg = hookResult.reason ?? `Tool '${tc.function.name}' blocked by PreToolUse hook.`
        auditLog({ type: 'tool_call', tool: tc.function.name, args: { ...parsedArgs, __blocked_by_hook: true } })
        cb.onToolCall(tc.function.name, parsedArgs)
        cb.onToolResult(tc.function.name, blockMsg, parsedArgs)
        return { tc, result: blockMsg }
      }
      if (hookResult.modifiedInput) {
        effectiveArgs = hookResult.modifiedInput
      }
    }

    // ── Undo snapshot (only for file-writing tools that passed all checks) ──
    if ((tc.function.name === 'write_file' || tc.function.name === 'patch_file') && effectiveArgs.path) {
      const filePath = effectiveArgs.path as string
      this.filesModified.add(filePath)
      try {
        const oldContent = await readFile(filePath, 'utf-8')
        this.undoStack.push({ path: filePath, content: oldContent })
      } catch {
        this.undoStack.push({ path: filePath, content: '' })
      }
      if (this.undoStack.length > UNDO_STACK_MAX) this.undoStack.shift()
      await createFileCheckpoint(this.hookSessionId, filePath, tc.function.name).catch(() => {})
    }

    // ── 4. Execute tool ──────────────────────────────────────────────────────
    cb.onToolCall(tc.function.name, effectiveArgs)
    auditLog({ type: 'tool_call', tool: tc.function.name, args: effectiveArgs })
    this.toolCallTotal++
    const t0 = Date.now()
    const result = await this.executeTool(tc.function.name, effectiveArgs)
    auditLog({ type: 'tool_result', tool: tc.function.name, result: result.slice(0, 200), durationMs: Date.now() - t0 })

    // PostToolUse hooks (fire-and-forget)
    if (this.settings.hooks) {
      runPostToolHooks(this.settings.hooks as HooksConfig, tc.function.name, effectiveArgs, result, this.hookSessionId).catch(() => {})
    }

    cb.onToolResult(tc.function.name, result, effectiveArgs)
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
    // OAuth provider uses the orchestrator which converts everything to plain text
    // via buildPrompt(). The orchestrator already handles role:'tool' (formats as
    // "Tool Response (name): ...") and tool_calls on assistant messages (formats as
    // <tool_call> blocks). No sanitization needed — the raw roles never reach the
    // DeepSeek API directly; they are consumed as metadata by buildPrompt().
    return messages
  }

  private async executeTool(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.toolMap.get(name)
    if (!tool) return `Unknown tool: ${name}`

    const validation = validateToolArguments(tool, args)
    if (!validation.valid) {
      return validation.error || `[Tool Error: ${name}] Invalid arguments`
    }

    try {
      return await tool.execute(args)
    } catch (e: unknown) {
      return `Error: ${(e as Error).message}`
    }
  }

  // ponytail: auto-learn 0-1 facts per turn, fire-and-forget
  private syncTurn(): void {
    const msgs = this.messages.filter(m => typeof m === 'object' && 'role' in m && m.role === 'assistant')
    if (msgs.length < 2) return // nothing to learn from a short turn

    const recent = this.messages.slice(-10).map(m => {
      if (typeof m === 'object' && 'role' in m) {
        return { role: (m as any).role, content: typeof (m as any).content === 'string' ? (m as any).content : '' }
      }
      return null
    }).filter(Boolean)

    try {
      const result = this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system' as const, content: 'Extract 0-1 NEW facts about the user or their project from this conversation. Only facts worth remembering across sessions (preferences, project details, workflow patterns). If nothing new: respond with exactly "NONE". Otherwise respond with just the fact, one line, max 100 chars.' },
          ...(recent as any[]),
        ],
        max_tokens: 100,
        temperature: 0,
      })
      // ponytail: guard against non-thenable return (e.g. test mocks returning iterables)
      if (result && typeof result.then === 'function') {
        result.then((res: any) => {
          const fact = res.choices?.[0]?.message?.content?.trim()
          if (fact && fact !== 'NONE' && fact.length > 5 && fact.length <= 100) {
            addEntry('agent', fact)
          }
        }).catch(() => {})
      }
    } catch {
      // ponytail: silent fail — never block user for memory sync
    }
  }
}
