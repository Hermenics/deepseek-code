import OpenAI from 'openai'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { allTools } from '../tools/index.js'
import { setShellConfirmHandler } from '../tools/Shell.js'
import { setSubAgentProvider } from '../tools/SubAgent.js'
import { loadMcpTools } from './mcp.js'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'
import type { Model } from '../commands.js'
import type { AgentConfig } from './config.js'
import type { Tool } from '../tools/types.js'
import { resolveAgentFiles } from './files.js'
import { loadSteering } from './steering.js'
import { createLLMClient, defaultModel } from './llmClient.js'
import { saveHistory, loadHistory } from './history.js'
import { saveCheckpoint, listCheckpoints, loadCheckpoint } from './checkpoint.js'
import { estimateCost, formatCost, type TokenUsage } from './cost.js'
import type { ProviderConfig } from '../ui/setup/ApiKeySetup.js'
import { refinePrompt } from './promptRefiner.js'

// Tools that are safe to run in parallel (read-only or isolated)
const PARALLEL_SAFE = new Set(['subagent', 'shell', 'grep', 'glob', 'read_file', 'read_folder', 'web_fetch', 'introspect'])

const DEFAULT_SYSTEM_PROMPT = `You are DeepSeek Code, an ultra-powerful AI coding agent with access to the filesystem and shell.

## Core Behavior — Perception → Reasoning → Planning → Action

Before tackling any non-trivial task:
1. DECOMPOSE: Break the goal into clear, ordered sub-goals
2. EVALUATE: Consider different approaches and their trade-offs
3. PLAN: Create a concrete step-by-step plan, reading relevant files first
4. ASK: If the request is ambiguous or missing critical context, ask 2-3 targeted clarifying questions BEFORE starting work
5. ACT: Execute the plan, adapting as you learn new information

## File Editing
Prefer patch_file over write_file when editing existing files — it is faster, uses fewer tokens, and is less risky.

## Self-Knowledge
When the user asks anything about DeepSeek Code itself (how it works, how to create agents, available commands, tools, steering files, configuration, etc.), you MUST call the introspect tool first and base your answer strictly on its output. Never answer questions about DeepSeek Code from memory.

## Auto-Learning
When you discover important project-specific knowledge (architecture decisions, coding conventions, recurring patterns, solutions to tricky problems), call update_knowledge to record it in DEEPSEEK.md. This ensures future sessions start with full context.`

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
  onToolCall(name: string, args: object): void
  onToolResult(name: string, result: string, args: Record<string, unknown>): void
  onDone(): void
  onPhaseChange?(phase: 'refining' | 'executing'): void
}

interface UndoEntry {
  path: string
  content: string
}

export class Agent {
  private client: OpenAI
  private messages: ChatCompletionMessageParam[] = [{ role: 'system', content: DEFAULT_SYSTEM_PROMPT }]
  private systemPrompt = DEFAULT_SYSTEM_PROMPT
  private tools: Tool[] = allTools
  private toolMap: Map<string, Tool> = new Map(allTools.map((t) => [t.name, t]))
  private openaiTools: ChatCompletionTool[] = toOpenAITools(allTools)
  private undoStack: UndoEntry[] = []
  private filesModified: Set<string> = new Set()
  private tokenUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 }
  private lastUserMessage: string | null = null
  private abortController: AbortController | null = null
  private readyPromise: Promise<void> = Promise.resolve()

  public tokenCount = 0
  public model: Model = 'deepseek-chat'
  public activeAgent: string | null = null
  public provider: ProviderConfig['provider'] = 'deepseek'
  public refineEnabled = true
  private confirmHandler: ((message: string) => Promise<boolean>) | null = null
  private toolPermissionHandler: ToolPermissionHandler | null = null
  private sessionApprovedTools: Set<string> = new Set()
  private allowedTools: string[] | '*' | null = null

  setConfirmHandler(handler: ((message: string) => Promise<boolean>) | null) {
    this.confirmHandler = handler
    setShellConfirmHandler(handler)
  }

  setToolPermissionHandler(handler: ToolPermissionHandler | null) {
    this.toolPermissionHandler = handler
  }

  constructor(providerConfig?: ProviderConfig) {
    this.client = providerConfig
      ? createLLMClient(providerConfig)
      : new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com' })
    if (providerConfig) {
      this.provider = providerConfig.provider
      this.model = (providerConfig.provider === 'local' && providerConfig.localModel
        ? providerConfig.localModel
        : defaultModel(providerConfig.provider)) as Model
      // Propagate provider to SubAgent so it uses the same backend
      setSubAgentProvider(providerConfig)
    }
    // Initialize async — readyPromise is awaited in run() to prevent race conditions
    this.readyPromise = this.initialize()
  }

  private async initialize(): Promise<void> {
    try {
      const [steering, deepseekMd, mcpTools, history] = await Promise.all([
        loadSteering(),
        readFile(join(process.cwd(), 'DEEPSEEK.md'), 'utf-8').catch(() => ''),
        loadMcpTools(),
        loadHistory(),
      ])
      const parts: string[] = []
      if (steering) parts.push(steering)
      if (deepseekMd) parts.push(`--- DEEPSEEK.md ---\n${deepseekMd.trim()}`)
      if (parts.length) {
        this.systemPrompt = `${DEFAULT_SYSTEM_PROMPT}\n\n${parts.join('\n\n')}`
      }
      this.messages = [
        { role: 'system', content: this.systemPrompt },
        ...history.filter((m) => m.role !== 'system'),
      ]
      if (mcpTools.length) {
        this.tools = [...allTools, ...mcpTools]
        this.toolMap = new Map(this.tools.map((t) => [t.name, t]))
        this.openaiTools = toOpenAITools(this.tools)
      }
    } catch {
      // Fall back to defaults — agent still works without steering/history
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
    const nonSystem = this.messages.filter((m) => m.role !== 'system')
    if (nonSystem.length === 0) return 'Nothing to compact.'
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: 'Summarize the following conversation concisely, preserving all key decisions, code snippets, and context needed to continue the work.' },
        { role: 'user', content: nonSystem.map((m) => `[${m.role}]: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n\n') },
      ],
    })
    const summary = response.choices[0]?.message.content ?? '(no summary)'
    this.messages = [
      { role: 'system', content: this.systemPrompt },
      { role: 'assistant', content: `[Compacted context]\n${summary}` },
    ]
    await saveHistory(this.messages)
    return summary
  }

  setModel(m: Model) { this.model = m }

  clearHistory() {
    this.messages = [{ role: 'system', content: this.systemPrompt }]
    this.undoStack = []
    this.filesModified = new Set()
  }

  async applyAgentConfig(config: AgentConfig): Promise<void> {
    let prompt = config.systemPrompt
    if (config.files?.length) {
      const injected = await resolveAgentFiles(config.files)
      if (injected) prompt += `\n\n${injected}`
    }
    this.systemPrompt = prompt
    if (config.model) this.model = config.model
    this.activeAgent = config.name
    this.allowedTools = config.allowedTools ?? null
    this.sessionApprovedTools = new Set()
    this.clearHistory()
  }

  resetAgent() {
    this.systemPrompt = DEFAULT_SYSTEM_PROMPT
    this.model = 'deepseek-chat'
    this.activeAgent = null
    this.allowedTools = null
    this.sessionApprovedTools = new Set()
    this.clearHistory()
  }

  async run(userMessage: string, cb: AgentCallbacks) {
    // Wait for async initialization to complete before running
    await this.readyPromise

    const now = new Date().toLocaleString()
    this.lastUserMessage = userMessage

    // Phase 1: optionally refine the prompt
    cb.onPhaseChange?.('refining')
    const refineModel = this.provider === 'deepseek' ? 'deepseek-chat' : this.model
    const refined = this.refineEnabled
      ? await refinePrompt(this.client, refineModel, userMessage).catch(() => userMessage)
      : userMessage

    // Phase 2: execute with the (possibly refined) prompt
    cb.onPhaseChange?.('executing')
    this.messages.push({ role: 'user', content: `[${now}]\n${refined}` })
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
        // Never retry aborts
        if (err.name === 'AbortError') throw e
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
    while (true) {
      this.abortController = new AbortController()

      let stream: Awaited<ReturnType<typeof this.client.chat.completions.create>>
      try {
        stream = await this.withRetry(() =>
          this.client.chat.completions.create(
            {
              model: this.model,
              messages: this.messages,
              tools: this.openaiTools,
              stream: true,
              stream_options: { include_usage: true },
            },
            { signal: this.abortController!.signal },
          )
        )
      } catch (e: unknown) {
        if ((e as Error).name === 'AbortError' || (e as { status?: number }).status === 0) {
          cb.onDone()
          return
        }
        throw e
      }

      let assistantText = ''
      const toolCalls: Map<number, { id: string; name: string; args: string }> = new Map()

      try {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta
          if (!delta) {
            if (chunk.usage) {
              this.tokenCount += chunk.usage.total_tokens
              this.tokenUsage.promptTokens += chunk.usage.prompt_tokens
              this.tokenUsage.completionTokens += chunk.usage.completion_tokens
              this.tokenUsage.cachedTokens += (chunk.usage as { prompt_cache_hit_tokens?: number }).prompt_cache_hit_tokens ?? 0
            }
            continue
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
        if ((e as Error).name === 'AbortError') {
          if (assistantText) this.messages.push({ role: 'assistant', content: assistantText })
          await saveHistory(this.messages)
          cb.onDone()
          return
        }
        throw e
      }

      if (toolCalls.size === 0) {
        this.messages.push({ role: 'assistant', content: assistantText })
        await saveHistory(this.messages)
        cb.onDone()
        return
      }

      const tcArray = [...toolCalls.values()].map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.args },
      }))
      this.messages.push({ role: 'assistant', content: assistantText || null, tool_calls: tcArray })

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
        }
      }

      // ── Partition: parallel-safe vs sequential ─────────────────────────────
      const canParallelize = parsedList.every(({ tc }) => PARALLEL_SAFE.has(tc.function.name))

      if (canParallelize && parsedList.length > 1) {
        // Run all tool calls concurrently
        const results = await Promise.all(
          parsedList.map(async ({ tc, parsedArgs }) => {
            cb.onToolCall(tc.function.name, parsedArgs)
            const result = await this.executeTool(tc.function.name, parsedArgs)
            cb.onToolResult(tc.function.name, result, parsedArgs)
            return { tc, result }
          })
        )
        for (const { tc, result } of results) {
          this.messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
        }
      } else {
        // Sequential execution (file writes, or mixed batch)
        for (const { tc, parsedArgs } of parsedList) {
          cb.onToolCall(tc.function.name, parsedArgs)

          // ── Tool permission check ────────────────────────────────────────
          const needsPermission = this.allowedTools !== null && (
            this.allowedTools === '*' ||
            this.allowedTools.includes(tc.function.name)
          )
          if (needsPermission && !this.sessionApprovedTools.has(tc.function.name) && this.toolPermissionHandler) {
            const decision = await this.toolPermissionHandler(tc.function.name, parsedArgs)
            if (decision === 'deny') {
              const denyMsg = `Tool '${tc.function.name}' was denied by the user. Suggest an alternative approach that does not require this tool, or ask the user what they would like to do instead.`
              cb.onToolResult(tc.function.name, denyMsg, parsedArgs)
              this.messages.push({ role: 'tool', tool_call_id: tc.id, content: denyMsg })
              continue
            }
            if (decision === 'session') {
              this.sessionApprovedTools.add(tc.function.name)
            }
          }

          const result = await this.executeTool(tc.function.name, parsedArgs)
          cb.onToolResult(tc.function.name, result, parsedArgs)
          this.messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
        }
      }
    }
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
