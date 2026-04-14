import OpenAI from 'openai'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { allTools } from '../tools/index.js'
import { loadMcpTools } from './mcp.js'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'
import type { Model } from '../commands.js'
import type { AgentConfig } from './config.js'
import type { Tool } from '../tools/types.js'
import { resolveAgentFiles } from './files.js'
import { loadSteering } from './steering.js'
import { createLLMClient, defaultModel } from './llmClient.js'
import { saveHistory, loadHistory } from './history.js'
import type { ProviderConfig } from '../ui/setup/ApiKeySetup.js'

const DEFAULT_SYSTEM_PROMPT = `You are DeepSeek Code, an AI coding assistant with access to the filesystem and shell.

Be concise. Avoid unnecessary explanations, summaries, or step-by-step narration of what you are doing. Let the tools speak for themselves.

IMPORTANT: When the user asks anything about DeepSeek Code itself (how it works, how to create agents, available commands, tools, steering files, configuration, etc.), you MUST call the introspect tool first and base your answer strictly on its output. Never answer questions about DeepSeek Code from memory.`

function toOpenAITools(tools: Tool[]): ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown> },
  }))
}

export interface AgentCallbacks {
  onToken(text: string): void
  onToolCall(name: string, args: object): void
  onToolResult(name: string, result: string, args: Record<string, unknown>): void
  onDone(): void
}

export class Agent {
  private client: OpenAI
  private messages: ChatCompletionMessageParam[] = [{ role: 'system', content: DEFAULT_SYSTEM_PROMPT }]
  private systemPrompt = DEFAULT_SYSTEM_PROMPT
  private tools: Tool[] = allTools
  private toolMap: Map<string, Tool> = new Map(allTools.map((t) => [t.name, t]))
  private openaiTools: ChatCompletionTool[] = toOpenAITools(allTools)
  public tokenCount = 0
  public model: Model = 'deepseek-chat'
  public activeAgent: string | null = null
  public provider: ProviderConfig['provider'] = 'deepseek'

  constructor(providerConfig?: ProviderConfig) {
    this.client = providerConfig
      ? createLLMClient(providerConfig)
      : new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com' })
    if (providerConfig) {
      this.provider = providerConfig.provider
      this.model = defaultModel(providerConfig.provider) as Model
    }
    // Load steering files, DEEPSEEK.md and MCP tools asynchronously
    Promise.all([
      loadSteering(),
      readFile(join(process.cwd(), 'DEEPSEEK.md'), 'utf-8').catch(() => ''),
      loadMcpTools(),
      loadHistory(),
    ]).then(([steering, deepseekMd, mcpTools, history]) => {
      const parts: string[] = []
      if (steering) parts.push(steering)
      if (deepseekMd) parts.push(`--- DEEPSEEK.md ---\n${deepseekMd.trim()}`)
      if (parts.length) {
        this.systemPrompt = `${DEFAULT_SYSTEM_PROMPT}\n\n${parts.join('\n\n')}`
      }
      // Restore history (non-system messages) on top of current system prompt
      this.messages = [
        { role: 'system', content: this.systemPrompt },
        ...history.filter((m) => m.role !== 'system'),
      ]
      if (mcpTools.length) {
        this.tools = [...allTools, ...mcpTools]
        this.toolMap = new Map(this.tools.map((t) => [t.name, t]))
        this.openaiTools = toOpenAITools(this.tools)
      }
    })
  }

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
    this.clearHistory()
  }

  resetAgent() {
    this.systemPrompt = DEFAULT_SYSTEM_PROMPT
    this.model = 'deepseek-chat'
    this.activeAgent = null
    this.clearHistory()
  }

  async run(userMessage: string, cb: AgentCallbacks) {
    const now = new Date().toLocaleString()
    this.messages.push({ role: 'user', content: `[${now}]\n${userMessage}` })
    await this.loop(cb)
  }

  private async loop(cb: AgentCallbacks) {
    while (true) {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages: this.messages,
        tools: this.openaiTools,
        stream: true,
      })

      let assistantText = ''
      const toolCalls: Map<number, { id: string; name: string; args: string }> = new Map()

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta
        if (!delta) continue

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

        if (chunk.usage) {
          this.tokenCount += chunk.usage.total_tokens
        }
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

      for (const tc of tcArray) {
        let parsedArgs: Record<string, unknown> = {}
        try { parsedArgs = JSON.parse(tc.function.arguments) } catch { }
        cb.onToolCall(tc.function.name, parsedArgs)

        const tool = this.toolMap.get(tc.function.name)
        let result: string
        if (tool) {
          try { result = await tool.execute(parsedArgs) } catch (e: unknown) {
            result = `Error: ${(e as Error).message}`
          }
        } else {
          result = `Unknown tool: ${tc.function.name}`
        }

        cb.onToolResult(tc.function.name, result, parsedArgs)
        this.messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
      }
    }
  }
}
