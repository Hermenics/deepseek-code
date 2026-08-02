import type { ProviderConfig } from '../../types/provider.js'
import type { Tool, } from '../types.js'
import { listAgents, loadAgentConfig, type LoadedAgent } from '../../agent/config.js'
import type { ToolExecutionContext } from '../../orchestration/types.js'
import {
  getSubAgentSession,
  setLegacyAgentNoteCallback,
  setSubAgentModel,
  setSubAgentProvider,
  spawnSubAgentTask,
} from '../SubAgent/SubAgent.js'

/** @deprecated Agent instances configure their own OrchestratorSession. */
export function setAskAgentProvider(provider: ProviderConfig): void { setSubAgentProvider(provider) }
/** @deprecated Agent instances configure their own OrchestratorSession. */
export function setAskAgentModel(model: string): void { setSubAgentModel(model) }
/** @deprecated Use Agent.setAgentNoteCallback. */
export function setAgentNoteCallback(callback: (agentName: string, text: string) => void): void { setLegacyAgentNoteCallback(callback) }

async function dispatch(agent: string, question: string, context?: ToolExecutionContext, resolvedAgent?: LoadedAgent) {
  const { handle } = await spawnSubAgentTask({ task: question, agent, mode: 'background', context: 'fresh' }, context, 'ask_agent', resolvedAgent)
  return { schemaVersion: 1 as const, sessionId: handle.sessionId, taskId: handle.taskId, state: handle.status().state, agent }
}

export const AskAgent: Tool = {
  name: 'ask_agent',
  description: 'Ask one or more configured specialists in the background. Returns cancellable task handles immediately.',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      agent: { type: 'string' }, question: { type: 'string', minLength: 1 }, broadcast: { type: 'boolean' },
    },
    required: ['question'],
  },
  async execute(args, context) {
    const question = args.question as string
    const agent = args.agent as string | undefined
    if (args.broadcast === true) {
      const session = getSubAgentSession(context)
      const available = (await listAgents(session.projectRoot)).filter(item => item.enabled && ['subagent', 'both'].includes(item.usage))
      if (available.length === 0) return 'Error: no enabled subagents are available for broadcast.'
      const settled = await Promise.allSettled(available.map(item => dispatch(item.name, question, context)))
      const tasks = settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
      const failures = settled.flatMap((result, index) => result.status === 'rejected'
        ? [{ agent: available[index]!.name, error: result.reason instanceof Error ? result.reason.message : String(result.reason) }]
        : [])
      return JSON.stringify({
        schemaVersion: 1,
        message: `Dispatched to ${tasks.map(item => `@${item.agent}`).join(', ') || 'no agents'}. Responses will arrive in your next turn.`,
        tasks,
        failures,
      })
    }
    if (!agent) return 'Error: specify an agent from the active registry or use broadcast=true.'
    let resolved: LoadedAgent | undefined
    try {
      resolved = await loadAgentConfig(agent, getSubAgentSession(context).projectRoot)
    } catch (error) {
      return `Error: ${(error as Error).message}`
    }
    try {
      const task = await dispatch(agent, question, context, resolved)
      return JSON.stringify({ ...task, message: `Dispatched to @${agent}. Response will arrive in your next turn.` })
    } catch (error) {
      return `Error: ${(error as Error).message}`
    }
  },
}
