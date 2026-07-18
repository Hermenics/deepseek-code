import type { SubagentState } from './types.js'
import type { SubAgentResult } from '../../tools/SubAgent/contracts.js'

export interface SubagentStartInput { id: string; task: string; role?: string | null; agentName?: string | null }
export interface SubagentProgressInput { id: string; info: string }
export interface SubagentToolUseInput { id: string; tool: string; info?: string }
export interface SubagentDoneInput { id: string; result: string; tokens?: number; costUsd?: number; structured?: SubAgentResult; confidence?: number | null; verified?: boolean | null }
export interface SubagentErrorInput { id: string; error: string }
export interface SubagentStateInput { id: string; status: SubagentState['status']; task?: string; role?: string | null; agentName?: string | null; error?: string }

export interface UseSubagentsReturn {
  agents: SubagentState[]
  onSubagentStart: (input: SubagentStartInput) => void
  onSubagentProgress: (input: SubagentProgressInput) => void
  onSubagentToolUse: (input: SubagentToolUseInput) => void
  onSubagentDone: (input: SubagentDoneInput) => void
  onSubagentError: (input: SubagentErrorInput) => void
  onSubagentState: (input: SubagentStateInput) => void
  clearResolved: () => void
}

export function useSubagents(): UseSubagentsReturn {
  const hook: UseSubagentsReturn = {
    agents: [],

    onSubagentStart({ id, task, role, agentName }) {
      const existing = hook.agents.find(agent => agent.id === id)
      if (existing) {
        existing.task = task
        existing.status = 'running'
        existing.role = (role as SubagentState['role']) ?? existing.role
        existing.agentName = agentName ?? existing.agentName
        return
      }
      const agent: SubagentState = {
        id,
        task,
        status: 'running',
        colorIndex: hook.agents.length,
        toolCount: 0,
        lastToolInfo: null,
        startedAt: Date.now(),
        durationMs: null,
        result: null,
        error: null,
        tokens: null,
        costUsd: null,
        role: (role as SubagentState['role']) ?? null,
        confidence: null,
        verified: null,
        agentName: agentName ?? null,
      }
      hook.agents.push(agent)
    },

    onSubagentProgress({ id, info }) {
      const agent = hook.agents.find(a => a.id === id)
      if (agent) agent.lastToolInfo = info
    },

    onSubagentToolUse({ id, tool, info }) {
      const agent = hook.agents.find(a => a.id === id)
      if (agent) {
        agent.toolCount++
        agent.lastToolInfo = info ?? tool
      }
    },

    onSubagentDone({ id, result, tokens, costUsd, structured, confidence, verified }) {
      const agent = hook.agents.find(a => a.id === id)
      if (agent) {
        agent.status = 'done'
        agent.result = result
        agent.durationMs = Date.now() - agent.startedAt
        if (tokens != null) agent.tokens = tokens
        if (costUsd != null) agent.costUsd = costUsd
        if (structured) {
          agent.confidence = structured.confidence
        }
        if (confidence != null) agent.confidence = confidence
        if (verified != null) agent.verified = verified
      }
    },

    onSubagentError({ id, error }) {
      const agent = hook.agents.find(a => a.id === id)
      if (agent) {
        agent.status = 'error'
        agent.error = error
        agent.durationMs = Date.now() - agent.startedAt
      }
    },

    onSubagentState({ id, status, task, role, agentName, error }) {
      let agent = hook.agents.find(candidate => candidate.id === id)
      if (!agent) {
        hook.onSubagentStart({ id, task: task ?? id, role, agentName })
        agent = hook.agents.find(candidate => candidate.id === id)!
      }
      agent.status = status
      if (error) agent.error = error
      if (['done', 'failed', 'error', 'cancelled', 'timed_out'].includes(status)) agent.durationMs = Date.now() - agent.startedAt
    },

    clearResolved() {
      hook.agents = hook.agents.filter(a => ['queued', 'running', 'blocked'].includes(a.status))
    },
  }

  return hook
}
