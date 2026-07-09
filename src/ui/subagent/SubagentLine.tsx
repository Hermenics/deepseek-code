import React, { useState, useEffect } from 'react'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import { getThemeColors } from '../theme.js'
import { useClock } from '../clock.js'
import { getAgentColor } from './colorManager.js'
import type { SubagentLineProps } from './types.js'
import type { SubAgentRole } from '../../tools/SubAgent/permissions.js'

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

const ROLE_COLORS: Record<string, string> = {
  reader: 'cyan',
  writer: 'yellow',
  executor: 'green',
  reviewer: 'magenta',
  unrestricted: 'red',
}

function getRoleColor(role: SubAgentRole): string {
  return ROLE_COLORS[role] ?? 'gray'
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8) return 'green'
  if (confidence >= 0.5) return 'yellow'
  return 'red'
}

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  const m = Math.floor(ms / 60000)
  const s = Math.round((ms % 60000) / 1000)
  return `${m}m ${s}s`
}

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(3)}`
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + '…' : str
}

export function SubagentLine({ agent, isLast, theme = 'dark' }: SubagentLineProps): React.ReactElement {
  const colors = getThemeColors(theme)
  const agentColor = getAgentColor(agent.colorIndex, colors)
  const tick = useClock()

  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    setElapsed(0)
    if (agent.status !== 'running') return
    const t = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [agent.id, agent.status])

  const treeChar = isLast ? '└─' : '├─'
  const taskLabel = truncate(agent.task, 40)

  return (
    <Box flexDirection="row" gap={1}>
      <Text color={colors.textDim}>{treeChar}</Text>
      <Text color={agentColor} bold>{agent.agentName ?? 'Subagent'}</Text>
      {agent.role && (
        <Text color={getRoleColor(agent.role)}>[{agent.role}]</Text>
      )}
      <Text color={colors.textSubtle}>({taskLabel})</Text>

      {agent.status === 'running' && (
        <>
          <Text color={colors.primary}>{SPINNER_FRAMES[tick % SPINNER_FRAMES.length]}</Text>
          {agent.lastToolInfo && (
            <Text color={colors.textDim}>{truncate(agent.lastToolInfo, 30)}</Text>
          )}
          <Text color={colors.textDim}>{agent.toolCount} tools</Text>
          {elapsed > 0 && <Text color={colors.textDim}>{elapsed}s</Text>}
        </>
      )}

      {agent.status === 'done' && (
        <>
          <Text color={colors.success}>✓</Text>
          <Text color={colors.textSubtle}>Done</Text>
          <Text color={colors.textDim}>·</Text>
          <Text color={colors.textDim}>{agent.toolCount} tools</Text>
          {agent.durationMs !== null && (
            <Text color={colors.textDim}>· {formatDuration(agent.durationMs)}</Text>
          )}
          {agent.confidence !== null && (
            <Text color={getConfidenceColor(agent.confidence)}>· {Math.round(agent.confidence * 100)}%</Text>
          )}
          {agent.tokens !== null && (
            <Text color={colors.textDim}>· {formatTokens(agent.tokens)}</Text>
          )}
          {agent.costUsd !== null && (
            <Text color={colors.warning}>{formatCost(agent.costUsd)}</Text>
          )}
          {agent.verified === true && (
            <Text color="green">✓✓</Text>
          )}
          {agent.verified === false && (
            <Text color="red">⚠ unverified</Text>
          )}
        </>
      )}

      {agent.status === 'error' && (
        <>
          <Text color={colors.error}>✗</Text>
          {agent.error && (
            <Text color={colors.error}>{truncate(agent.error, 50)}</Text>
          )}
        </>
      )}
    </Box>
  )
}
