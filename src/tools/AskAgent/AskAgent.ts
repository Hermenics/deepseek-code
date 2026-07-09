import { randomUUID } from 'node:crypto'
import type { Tool } from '../types.js'
import type { ProviderConfig } from '../../types/provider.js'
import { defaultModel } from '../../agent/llmClient.js'
import { isFixedAgent, getFixedAgent, buildFixedAgentPrompt, type FixedAgentName } from '../SubAgent/fixedAgents.js'
import { runSubAgentLoop } from '../SubAgent/executor.js'
import { acquire, release } from '../SubAgent/concurrency.js'
import { getToolsForRole } from '../SubAgent/permissions.js'
import { getCurrentMemory, formatMemoryForPrompt } from '../SubAgent/memory.js'
import { parseSubAgentResult, formatResultForParent } from '../SubAgent/contracts.js'

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
function spawnBackgroundAgent(agentName: FixedAgentName, question: string): void {
  const def = getFixedAgent(agentName)
  const agentId = randomUUID().slice(0, 8)
  const provider = askAgentProvider
  const modelName = askAgentModel ?? defaultModel(provider.provider)

  // Snapshot memory synchronously before the async boundary (memory resets each turn)
  const memory = formatMemoryForPrompt(getCurrentMemory())

  // Fire and forget — no await
  void (async () => {
    await acquire()
    try {
      // Lazy import to avoid circular dependency
      const { allTools } = await import('../index.js')
      const tools = allTools.filter((t) => t.name !== 'subagent' && t.name !== 'ask_agent')
      const filteredTools = getToolsForRole(def.role, tools)

      const prompt = buildFixedAgentPrompt(def, question, memory)

      const { resultText } = await runSubAgentLoop(
        prompt, question, agentId, filteredTools, provider, modelName,
      )

      const structured = parseSubAgentResult(resultText)
      const formatted = formatResultForParent(structured)

      // Deliver response via note callback (with truncation marker if needed)
      const MAX_NOTE_LEN = 500
      const note = formatted.length > MAX_NOTE_LEN
        ? formatted.slice(0, MAX_NOTE_LEN) + ' [truncated]'
        : formatted
      noteCallback?.(def.displayName, note)
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e ?? 'unknown error')
      noteCallback?.(def.displayName, `Error: ${errMsg}`)
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
        enum: ['coder', 'reviewer', 'tester'],
        description: 'Which specialist to ask. Required unless broadcast=true.',
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
      // Fan out to all 3 fixed agents
      const agents: FixedAgentName[] = ['coder', 'reviewer', 'tester']
      for (const name of agents) {
        spawnBackgroundAgent(name, question)
      }
      return `Dispatched to @coder, @reviewer, @tester. Responses will arrive in your next turn.`
    }

    // Single agent
    if (!agentArg || !isFixedAgent(agentArg)) {
      return `Error: specify a valid agent ("coder", "reviewer", or "tester") or use broadcast=true.`
    }

    spawnBackgroundAgent(agentArg, question)
    return `Dispatched to @${agentArg}. Response will arrive in your next turn.`
  },
}
