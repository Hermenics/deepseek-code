import type { SubAgentRole } from '../../tools/SubAgent/permissions.js'

export type SubagentStatus = 'running' | 'done' | 'error'

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
