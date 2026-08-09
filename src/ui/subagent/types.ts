import type { SubAgentRole } from '../../tools/SubAgent/permissions.js'
import type { TaskState } from '../../orchestration/types.js'

// `error` remains as a deprecated UI-only alias so older callback consumers and
// persisted views keep rendering while the runtime uses the explicit `failed` state.
export type SubagentStatus = TaskState | 'error'

export interface SubagentMessage {
  role: 'user' | 'assistant' | 'thinking'
  content: string
}

export interface SubagentState {
  id: string
  task: string
  status: SubagentStatus
  colorIndex: number
  toolCount: number
  lastToolInfo: string | null
  startedAt: number
  durationMs: number | null
  result: string | null
  error: string | null
  tokens: number | null        // total tokens used
  costUsd: number | null       // estimated cost in USD
  role: SubAgentRole | null
  confidence: number | null
  verified: boolean | null     // null = not verified, true = confirmed, false = flawed
  agentName: string | null      // 'Coder', 'Reviewer', 'Tester', or null for generic subagents
  mode?: 'foreground' | 'background'
  /** Live transcript of the subagent conversation (seeded with the task, then streamed deltas). */
  messages?: SubagentMessage[]
  model?: string | null
  workspace?: string | null
  workflowRunId?: string | null
  /** Workflow phase active when this agent was spawned; drives the phase/agent split in the monitor. */
  workflowPhase?: string | null
  /** Original instruction; `task` is only a short label when the workflow supplied one. */
  prompt?: string | null
}

export interface SubagentLineProps {
  agent: SubagentState
  isLast: boolean
  theme: import('../theme.js').ThemeName
}

export interface SubagentListProps {
  agents: SubagentState[]
  theme: import('../theme.js').ThemeName
}
