import { useEffect, useState } from 'react'
import useInput from '../../ink/hooks/use-input.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import { getFixedAgent, isFixedAgent } from '../../tools/SubAgent/fixedAgents.js'
import type { WorkflowRun } from '../../workflows/types.js'
import type { SubagentState, SubagentStatus } from '../subagent/types.js'
import { getThemeColors, type ThemeName } from '../theme.js'
import { useClock } from '../clock.js'

const ACTIVE_WORKFLOWS = new Set(['queued', 'running'])
const ACTIVE_AGENTS = new Set<SubagentStatus>(['queued', 'running', 'blocked'])
const RESUMABLE_AGENTS = new Set<SubagentStatus>(['blocked', 'failed', 'error', 'cancelled', 'timed_out'])
const STATUS_ICONS: Record<string, string> = {
  queued: '◌', running: '◯', blocked: 'Ⅱ', done: '✓', completed: '✓',
  failed: '✘', error: '✘', cancelled: '✘', timed_out: '⌛',
}

interface ActivityBase {
  kind: 'agent' | 'workflow'
  id: string
  label: string
  description: string
  status: string
  fixed: boolean
  active: boolean
  startedAt: number
}

export interface AgentActivityItem extends ActivityBase {
  kind: 'agent'
  agent: SubagentState
}

export interface WorkflowActivityItem extends ActivityBase {
  kind: 'workflow'
  run: WorkflowRun
  agents: SubagentState[]
}

export type ActivityItem = AgentActivityItem | WorkflowActivityItem

function truncate(value: string, width: number): string {
  if (width <= 0) return ''
  return value.length <= width ? value : `${value.slice(0, Math.max(0, width - 1))}…`
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function formatTokens(tokens: number | null | undefined): string | undefined {
  if (tokens == null) return undefined
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}m tok`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k tok`
  return `${tokens} tok`
}

/** Footer token metric matching Claude Code's `↓ 63.0k tokens` phrasing. */
function formatFooterTokens(tokens: number | null | undefined): string | undefined {
  if (tokens == null) return undefined
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}m tokens`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k tokens`
  return `${tokens} tokens`
}

function workflowProgress(run: WorkflowRun, agents: SubagentState[]): string {
  const done = agents.filter(agent => !ACTIVE_AGENTS.has(agent.status)).length
  return `${done}/${run.usage.agents} agents done`
}

/**
 * Resolves the display label for a subagent.
 *
 * @param agent - The subagent whose label should be resolved
 * @returns The display label and whether it identifies a fixed agent
 */
function agentLabel(agent: SubagentState): { label: string; fixed: boolean } {
  const name = agent.agentName
  if (name && isFixedAgent(name)) return { label: getFixedAgent(name).displayName, fixed: true }
  return { label: name || 'Subagent', fixed: false }
}

/**
 * Combines standalone agents and active workflows into a unified activity list sorted by start time.
 *
 * @returns The sorted activity items.
 */
export function buildActivityItems(agents: SubagentState[], workflows: WorkflowRun[]): ActivityItem[] {
  const agentItems: AgentActivityItem[] = agents.filter(agent => !agent.workflowRunId).map(agent => {
    const identity = agentLabel(agent)
    return {
      kind: 'agent', id: agent.id, ...identity, description: agent.task,
      status: agent.status, active: ACTIVE_AGENTS.has(agent.status), startedAt: agent.startedAt, agent,
    }
  })
  const workflowItems: WorkflowActivityItem[] = workflows
    .filter(run => ACTIVE_WORKFLOWS.has(run.status))
    .map(run => ({
      kind: 'workflow', id: run.runId, label: run.meta.name,
      description: run.meta.description ?? run.phase ?? 'Dynamic Workflow', status: run.status,
      fixed: false, active: true,
      startedAt: Date.parse(run.startedAt ?? run.createdAt) || Date.now(), run,
      agents: agents.filter(agent => agent.workflowRunId === run.runId),
    }))
  return [...agentItems, ...workflowItems].sort((left, right) => left.startedAt - right.startedAt)
}

/** Cap the activity list at maxRows, reporting how many entries were cut off. */
export function compactActivityItems(items: ActivityItem[], maxRows = 5): { rows: ActivityItem[]; overflow: number } {
  const rows = items.slice(0, Math.max(0, maxRows))
  return { rows, overflow: Math.max(0, items.length - rows.length) }
}

/** Contextual hint line for the open list, matching Claude Code's phrasing. */
export function buildActionHint(item: ActivityItem | undefined): string {
  if (!item) return '↑/↓ to select'
  const base = '↑/↓ to select · Enter to view'
  const actions: string[] = []
  if (item.kind === 'workflow') {
    actions.push('x stop')
    if (item.run.status === 'running') actions.push('p pause')
  } else if (item.active) {
    actions.push('x stop')
  }
  if (item.kind === 'agent' && RESUMABLE_AGENTS.has(item.agent.status)) actions.push('r resume')
  return actions.length ? `${base} · ${actions.join(' · ')}` : base
}

/**
 * Formats an activity item as a width-constrained display row.
 *
 * @param columns - Maximum width of the formatted row
 * @param now - Timestamp used to calculate elapsed time for active items
 * @param iconOverride - Optional icon to display instead of the item's status icon
 * @returns The formatted activity row
 * Format one activity row: the `◯`/`●` selection icon (overridable), label,
 * description and metrics, truncated to the requested width. Active agents
 * show `duration · ↓ tokens`; finished agents show `idle`.
 */
export function formatActivityItem(item: ActivityItem, columns: number, now = Date.now(), iconOverride?: string): string {
  const icon = iconOverride ?? '◯'
  const elapsed = item.kind === 'agent' && item.agent.durationMs != null
    ? item.agent.durationMs
    : item.kind === 'workflow' && item.run.completedAt
      ? Date.parse(item.run.completedAt) - item.startedAt
      : now - item.startedAt
  const metrics: string[] = []
  if (item.kind === 'agent') {
    if (item.active) {
      metrics.push(formatDuration(elapsed))
      const tokens = formatFooterTokens(item.agent.tokens)
      if (tokens) metrics.push(`↓ ${tokens}`)
    } else {
      metrics.push('idle')
    }
  } else {
    metrics.push(formatDuration(elapsed), workflowProgress(item.run, item.agents))
    const tokens = formatTokens(item.run.usage.tokens)
    if (tokens) metrics.push(tokens)
  }
  const prefix = `${icon} ${item.kind === 'workflow' ? 'workflow ' : ''}${item.label}`
  if (columns < 55) return truncate(`${prefix} · ${metrics[0]}`, columns)
  const suffix = metrics.join(' · ')
  const descriptionWidth = Math.max(8, columns - prefix.length - suffix.length - 6)
  return truncate(`${prefix}  ${truncate(item.description, descriptionWidth)}  ${suffix}`, columns)
}

function detailLines(item: ActivityItem, now: number): string[] {
  if (item.kind === 'workflow') {
    const run = item.run
    return [
      `${STATUS_ICONS[run.status] ?? '•'} workflow ${run.meta.name} · ${run.status}${run.phase ? ` · ${run.phase}` : ''}`,
      run.meta.description ?? 'Dynamic Workflow',
      `${run.usage.agents} agents · ${formatTokens(run.usage.tokens) ?? '0 tok'} · $${run.usage.costUsd.toFixed(4)}`,
      ...(run.error ? [`Error: ${run.error}`] : []),
    ]
  }
  const agent = item.agent
  const duration = agent.durationMs ?? Math.max(0, now - agent.startedAt)
  return [
    `${STATUS_ICONS[agent.status] ?? '•'} ${item.label} · ${item.fixed ? 'fixed' : 'temporary'} · ${agent.status}${agent.mode ? ` · ${agent.mode}` : ''}`,
    agent.task,
    `${agent.role ?? 'unclassified'} · ${formatDuration(duration)} · ${agent.toolCount} tools${agent.tokens != null ? ` · ${formatTokens(agent.tokens)}` : ''}`,
    ...(agent.lastToolInfo ? [`Latest: ${agent.lastToolInfo}`] : []),
    ...(agent.model ? [`Model: ${agent.model}`] : []),
    ...(agent.workspace ? [`Workspace: ${agent.workspace}`] : []),
    ...(agent.result ? [`Result: ${agent.result}`] : []),
    ...(agent.error ? [`Error: ${agent.error}`] : []),
  ]
}

export interface ActivityFooterProps {
  agents: SubagentState[]
  workflows: WorkflowRun[]
  open: boolean
  onClose(): void
  onOpenWorkflow(runId: string): void
  onOpenSubagent?(agentId: string): void
  /** Enter on the "main" row (selection index -1) — used to exit subagent focus. */
  onSelectMain?(): void
  onTaskAction(taskId: string, action: 'cancel' | 'resume'): Promise<string>
  onWorkflowAction(runId: string, action: 'pause' | 'stop'): Promise<string>
  theme?: ThemeName
  mainLabel?: string
}

/**
 * Bottom-of-screen activity panel with three render modes: closed (main header
 * plus flat rows and an overflow line), open (cursor-slot list where main is
 * selectable at index -1), and detail (full breakdown of the selected item).
 */
export function ActivityFooter({
  agents, workflows, open, onClose, onOpenWorkflow, onOpenSubagent, onSelectMain, onTaskAction, onWorkflowAction,
  theme = 'dark', mainLabel = 'main',
}: ActivityFooterProps) {
  const colors = getThemeColors(theme)
  useClock()
  const now = Date.now()
  // No useMemo here: `agents` is mutated in place upstream (useSubagents pushes
  // into the same array), so a reference-keyed memo never invalidates. The
  // clock tick re-renders ~every 80ms anyway, so just recompute directly.
  const items = buildActivityItems(agents, workflows)
  const [selected, setSelected] = useState(-1)
  const [detail, setDetail] = useState(false)
  const [feedback, setFeedback] = useState('')
  const columns = Math.max(20, (process.stdout.columns ?? 80) - 4)
  const report = (operation: Promise<string>) => void operation.then(setFeedback).catch(error => setFeedback((error as Error).message))

  useEffect(() => {
    if (!open) { setSelected(-1); setDetail(false); setFeedback(''); return }
    if (!items.length) onClose()
    else if (selected >= items.length) setSelected(items.length - 1)
  }, [items.length, onClose, open, selected])

  useInput((input, key, event) => {
    event.stopImmediatePropagation()
    if (key.escape) {
      if (detail) { setDetail(false); setFeedback('') } else onClose()
      return
    }
    if (detail) {
      if (key.upArrow || key.downArrow || key.return) return
    } else {
      if (key.upArrow) {
        if (selected === -1) { onClose(); return }
        setSelected(value => value - 1)
        return
      }
      if (key.downArrow) {
        if (items.length === 0) return
        setSelected(value => (value === items.length - 1 ? -1 : value + 1))
        return
      }
    }
    const item = items[selected]
    if (!item) {
      // Selection is on "main" (index -1): Enter returns to the main agent.
      if (key.return) onSelectMain?.()
      return
    }
    if (key.return) {
      if (!detail) {
        if (item.kind === 'workflow') onOpenWorkflow(item.run.runId)
        // Enter on an agent opens the subagent chat (Claude Code behavior).
        // The detail view stays reachable via 'v' below, and via the
        // setDetail fallback for consumers that don't wire onOpenSubagent.
        else if (onOpenSubagent) onOpenSubagent(item.agent.id)
        else setDetail(true)
      }
      return
    }
    if (input === 'v' && item.kind === 'agent') { setDetail(true); return }
    if (input === 'x' && item.active) {
      const operation = item.kind === 'workflow'
        ? onWorkflowAction(item.id, 'stop')
        : onTaskAction(item.id, 'cancel')
      report(operation)
      return
    }
    if (input === 'p' && item.kind === 'workflow' && item.run.status === 'running') {
      report(onWorkflowAction(item.id, 'pause'))
      return
    }
    if (input === 'r' && item.kind === 'agent' && RESUMABLE_AGENTS.has(item.agent.status)) report(onTaskAction(item.id, 'resume'))
  }, { isActive: open })

  if (!items.length) return null
  if (open && detail) {
    const safeIndex = Math.min(selected, items.length - 1)
    const item = items[safeIndex]!
    return (
      <Box flexDirection="column" paddingLeft={2}>
        {detailLines(item, now).map((line, index) => (
          <Text key={`${item.id}-${index}`} color={index === 0 ? colors.primary : colors.textDim}>{truncate(line, columns)}</Text>
        ))}
        {feedback && <Text color={colors.warning}>{truncate(feedback, columns)}</Text>}
        <Text color={colors.textSubtle}>{item.kind === 'workflow'
          ? item.run.status === 'running' ? 'Esc back · x stop · p pause' : 'Esc back · x stop'
          : RESUMABLE_AGENTS.has(item.agent.status) ? `Esc back${item.active ? ' · x stop' : ''} · r resume` : item.active ? 'Esc back · x stop' : 'Esc back'}</Text>
      </Box>
    )
  }

  const maxRows = open ? 8 : 5
  const start = open ? Math.min(Math.max(0, selected - maxRows + 1), Math.max(0, items.length - maxRows)) : 0
  const compact = compactActivityItems(items.slice(start), maxRows)
  // The selection cursor column is reserved on every row (closed or open) so the
  // content never shifts when opening/navigating; only the selected row fills it.
  const mainCursor = open && selected === -1 ? '❯ ' : '  '
  const mainIcon = open && selected !== -1 ? '◯' : '●'
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text color={selected === -1 ? colors.primary : colors.textDim}>{`${mainCursor}${mainIcon} ${mainLabel}`}</Text>
      {compact.rows.map((item, index) => {
        const isSelected = open && start + index === selected
        return (
          <Text key={`${item.kind}-${item.id}`} color={item.active ? colors.text : colors.textDim}>
            {`${isSelected ? '❯ ' : '  '}${formatActivityItem(item, open ? columns - 4 : columns - 2, now, isSelected ? '●' : undefined)}`}
          </Text>
        )
      })}
      {compact.overflow > 0 && <Text color={colors.textSubtle}>{`  … +${compact.overflow} activities`}</Text>}
      {open && <Text color={colors.textSubtle}>{feedback || buildActionHint(items[selected])}</Text>}
    </Box>
  )
}
