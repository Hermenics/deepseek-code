import type { SubAgentRole } from '../../tools/SubAgent/permissions.js'
import type { TaskState } from '../../orchestration/types.js'

// `error` remains as a deprecated UI-only alias so older callback consumers and
// persisted views keep rendering while the runtime uses the explicit `failed` state.
export type SubagentStatus = TaskState | 'error'

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
