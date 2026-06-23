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
