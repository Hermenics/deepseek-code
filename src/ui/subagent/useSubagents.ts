import type { SubagentState } from './types.js'

export interface SubagentStartInput { id: string; task: string }
export interface SubagentProgressInput { id: string; info: string }
export interface SubagentToolUseInput { id: string; tool: string; info?: string }
export interface SubagentDoneInput { id: string; result: string }
export interface SubagentErrorInput { id: string; error: string }

export interface UseSubagentsReturn {
  agents: SubagentState[]
  onSubagentStart: (input: SubagentStartInput) => void
  onSubagentProgress: (input: SubagentProgressInput) => void
  onSubagentToolUse: (input: SubagentToolUseInput) => void
  onSubagentDone: (input: SubagentDoneInput) => void
  onSubagentError: (input: SubagentErrorInput) => void
  clearResolved: () => void
}

export function useSubagents(): UseSubagentsReturn {
  const hook: UseSubagentsReturn = {
    agents: [],

    onSubagentStart({ id, task }) {
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

    onSubagentDone({ id, result }) {
      const agent = hook.agents.find(a => a.id === id)
      if (agent) {
        agent.status = 'done'
        agent.result = result
        agent.durationMs = Date.now() - agent.startedAt
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

    clearResolved() {
      hook.agents = hook.agents.filter(a => a.status === 'running')
    },
  }

  return hook
}
