import { randomUUID } from 'node:crypto'
import type { Tool } from '../types.js'
import type { ProviderConfig } from '../../types/provider.js'
import { defaultModel } from '../../agent/llmClient.js'
import { runSubAgentLoop } from '../SubAgent/executor.js'
import { acquire, release, setConcurrencyLimit } from '../SubAgent/concurrency.js'
import { getToolsForRole } from '../SubAgent/permissions.js'
import { getCurrentMemory, formatMemoryForPrompt } from '../SubAgent/memory.js'
import { parseSubAgentResult, formatResultForParent } from '../SubAgent/contracts.js'
import { composeSubAgentPrompt, listAgents, loadAgentConfig } from '../../agent/config.js'
import { loadMergedSettings } from '../../settings/loader.js'

// Provider config inherited from parent Agent (set during initialization)
let askAgentProvider: ProviderConfig = { provider: 'deepseek' }
let askAgentModel: string | null = null

export function setAskAgentProvider(cfg: ProviderConfig) {
  askAgentProvider = cfg
}

export function setAskAgentModel(model: string) {
  askAgentModel = model
}

// Callback for delivering async responses back to the main agent
type AgentNoteCallback = (agentName: string, text: string) => void
let noteCallback: AgentNoteCallback | null = null

export function setAgentNoteCallback(cb: AgentNoteCallback) {
  noteCallback = cb
}

/**
 * Spawn a fixed agent in the background. Does NOT await — fire and forget.
 * Result is delivered via noteCallback when done.
 */
function spawnBackgroundAgent(agentName: string, question: string): void {
  const agentId = randomUUID().slice(0, 8)
  const provider = askAgentProvider

  // Snapshot memory synchronously before the async boundary (memory resets each turn)
  const memory = formatMemoryForPrompt(getCurrentMemory())

  // Fire and forget — no await
  void (async () => {
    await acquire()
    try {
      const { config: def } = await loadAgentConfig(agentName)
      if (!['subagent', 'both'].includes(def.usage ?? 'primary')) throw new Error(`Agent '${agentName}' is not enabled for subagent use`)
      // Lazy import to avoid circular dependency
      const { allTools } = await import('../index.js')
      const tools = allTools.filter((t) => t.name !== 'subagent' && t.name !== 'ask_agent')
      let filteredTools = getToolsForRole(def.role ?? 'reader', tools)
      if (Array.isArray(def.tools)) filteredTools = filteredTools.filter(tool => def.tools!.includes(tool.name))

      const settings = await loadMergedSettings()
      setConcurrencyLimit(settings.agents?.concurrency ?? 5)
      const modelSettings = typeof settings.model === 'object' ? settings.model : undefined
      const modelName = def.model ?? settings.agents?.subagentModel ?? modelSettings?.subagent ?? askAgentModel ?? defaultModel(provider.provider)
      const prompt = composeSubAgentPrompt(
        def,
        settings.agents?.basePrompt ?? 'You are a specialized subagent of DeepSeek Code. Work only on the delegated task and return a direct result.',
        question,
        memory,
      )

      const { resultText } = await runSubAgentLoop(
        prompt, question, agentId, filteredTools, provider, modelName,
        { permissionPolicy: def.permissions?.policy ?? settings.agents?.permissionPolicy, permissions: def.permissions },
      )

      const structured = parseSubAgentResult(resultText)
      const formatted = formatResultForParent(structured)

      // Deliver response via note callback (with truncation marker if needed)
      const MAX_NOTE_LEN = 500
      const note = formatted.length > MAX_NOTE_LEN
        ? formatted.slice(0, MAX_NOTE_LEN) + ' [truncated]'
        : formatted
      noteCallback?.(def.name, note)
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e ?? 'unknown error')
      noteCallback?.(agentName, `Error: ${errMsg}`)
    } finally {
      release()
    }
  })()
}

export const AskAgent: Tool = {
  name: 'ask_agent',
  description: 'Ask a specialist agent a question asynchronously (fire-and-forget). Returns immediately — the response arrives as context in your next turn. Use for non-blocking second opinions, quick reviews, or consultations that should not interrupt your current work.',
  parameters: {
    type: 'object',
    properties: {
      agent: {
        type: 'string',
        description: 'Agent name from the active registry. Required unless broadcast=true.',
      },
      question: {
        type: 'string',
        description: 'The complete question with enough context for the agent to answer independently. Include file paths, code snippets, or constraints as needed.',
      },
      broadcast: {
        type: 'boolean',
        description: 'If true, sends the question to all 3 specialists (coder, reviewer, tester). Omit or set false to ask a single agent.',
      },
    },
    required: ['question'],
  },
  async execute(args) {
    const question = args.question as string
    const agentArg = args.agent as string | undefined
    const broadcast = args.broadcast as boolean | undefined

    if (broadcast) {
      const agents = (await listAgents()).filter(agent => agent.enabled && ['subagent', 'both'].includes(agent.usage))
      if (agents.length === 0) return 'Error: no enabled subagents are available for broadcast.'
      for (const { name } of agents) {
        spawnBackgroundAgent(name, question)
      }
      return `Dispatched to ${agents.map(agent => `@${agent.name}`).join(', ')}. Responses will arrive in your next turn.`
    }

    // Single agent
    if (!agentArg) {
      return 'Error: specify an agent from the active registry or use broadcast=true.'
    }

    try {
      const { config } = await loadAgentConfig(agentArg)
      if (!['subagent', 'both'].includes(config.usage ?? 'primary')) {
        return `Error: agent '${agentArg}' is not enabled for subagent use.`
      }
    } catch (error) { return `Error: ${(error as Error).message}` }

    spawnBackgroundAgent(agentArg, question)
    return `Dispatched to @${agentArg}. Response will arrive in your next turn.`
  },
}
