import type { ThemeColors } from '../theme.js'

export type AgentColorName =
  | 'agentRed'
  | 'agentBlue'
  | 'agentGreen'
  | 'agentYellow'
  | 'agentPurple'
  | 'agentOrange'
  | 'agentPink'
  | 'agentCyan'

export const AGENT_COLOR_KEYS: readonly AgentColorName[] = [
  'agentBlue',
  'agentGreen',
  'agentYellow',
  'agentPurple',
  'agentOrange',
  'agentPink',
  'agentCyan',
  'agentRed',
] as const

export function getAgentColor(colorIndex: number, colors: ThemeColors): string {
  const key = AGENT_COLOR_KEYS[colorIndex % AGENT_COLOR_KEYS.length]!
  return colors[key]
}
