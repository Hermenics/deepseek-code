import type { SubagentState } from './types.js'
import type { SubAgentResult } from '../../tools/SubAgent/contracts.js'

export interface SubagentStartInput { id: string; task: string; role?: string | null; agentName?: string | null; mode?: 'foreground' | 'background'; model?: string | null; workspace?: string | null; workflowRunId?: string | null }
export interface SubagentProgressInput { id: string; info: string }
export interface SubagentToolUseInput { id: string; tool: string; info?: string }
export interface SubagentDoneInput { id: string; result: string; tokens?: number; costUsd?: number; structured?: SubAgentResult; confidence?: number | null; verified?: boolean | null }
export interface SubagentErrorInput { id: string; error: string }
export interface SubagentStateInput { id: string; status?: SubagentState['status']; task?: string; role?: string | null; agentName?: string | null; mode?: 'foreground' | 'background'; model?: string | null; workspace?: string | null; workflowRunId?: string | null; error?: string; tokens?: number }
export interface SubagentMessageInput { id: string; role: 'user' | 'assistant'; content: string }

export interface UseSubagentsReturn {
  agents: SubagentState[]
  onSubagentStart: (input: SubagentStartInput) => void
  onSubagentProgress: (input: SubagentProgressInput) => void
  onSubagentToolUse: (input: SubagentToolUseInput) => void
  onSubagentDone: (input: SubagentDoneInput) => void
  onSubagentError: (input: SubagentErrorInput) => void
  onSubagentState: (input: SubagentStateInput) => void
  onSubagentMessage: (input: SubagentMessageInput) => void
  clearResolved: () => void
}

export function useSubagents(): UseSubagentsReturn {
  const hook: UseSubagentsReturn = {
    agents: [],

    onSubagentStart({ id, task, role, agentName, mode, model, workspace, workflowRunId }) {
      const existing = hook.agents.find(agent => agent.id === id)
      if (existing) {
        existing.task = task
        existing.status = 'running'
        existing.role = (role as SubagentState['role']) ?? existing.role
        existing.agentName = agentName ?? existing.agentName
        existing.mode = mode ?? existing.mode
        existing.model = model ?? existing.model
        existing.workspace = workspace ?? existing.workspace
        existing.workflowRunId = workflowRunId ?? existing.workflowRunId
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
        mode,
        messages: [{ role: 'user', content: task }],
        model: model ?? null,
        workspace: workspace ?? null,
        workflowRunId: workflowRunId ?? null,
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

    onSubagentState({ id, status, task, role, agentName, mode, model, workspace, workflowRunId, error, tokens }) {
      let agent = hook.agents.find(candidate => candidate.id === id)
      if (!agent) {
        hook.onSubagentStart({ id, task: task ?? id, role, agentName, mode, model, workspace, workflowRunId })
        agent = hook.agents.find(candidate => candidate.id === id)!
      }
      if (status !== undefined) agent.status = status
      if (mode) agent.mode = mode
      if (model != null) agent.model = model
      if (workspace != null) agent.workspace = workspace
      if (workflowRunId != null) agent.workflowRunId = workflowRunId
      if (tokens != null) agent.tokens = tokens
      if (error) agent.error = error
      if (status !== undefined && ['done', 'failed', 'error', 'cancelled', 'timed_out'].includes(status)) agent.durationMs = Date.now() - agent.startedAt
    },

    onSubagentMessage({ id, role, content }) {
      const agent = hook.agents.find(candidate => candidate.id === id)
      if (!agent) return
      if (!agent.messages) agent.messages = []
      agent.messages.push({ role, content })
    },

    clearResolved() {
      hook.agents = hook.agents.filter(a => a.workflowRunId || ['queued', 'running', 'blocked'].includes(a.status))
    },
  }

  return hook
}
