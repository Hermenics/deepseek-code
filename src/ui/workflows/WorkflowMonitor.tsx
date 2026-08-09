import { useEffect, useState } from 'react'
import useInput from '../../ink/hooks/use-input.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import type { WorkflowRun, WorkflowStatus } from '../../workflows/types.js'
import { getThemeColors, type ThemeName } from '../theme.js'
import { useClock } from '../clock.js'
import type { SubagentState } from '../subagent/types.js'
import { getFixedAgent, isFixedAgent } from '../../tools/SubAgent/fixedAgents.js'
import { formatActivityItem, type WorkflowActivityItem } from '../activity/ActivityFooter.js'

export const WORKFLOW_GROUPS: ReadonlyArray<{ name: string; statuses: readonly WorkflowStatus[] }> = [
  { name: 'Working', statuses: ['queued', 'running'] },
  { name: 'Needs input', statuses: ['paused'] },
  { name: 'Completed', statuses: ['completed', 'failed', 'cancelled', 'timed_out', 'budget_exhausted'] },
]

export type WorkflowGroup = { name: string; runs: WorkflowRun[] }

function truncate(value: string, width: number): string {
  return value.length <= width ? value : `${value.slice(0, Math.max(0, width - 1))}…`
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function formatTokens(tokens: number): string {
  const base = tokens >= 1_000 ? `${(tokens / 1_000).toFixed(1)}k tokens` : `${tokens} tokens`
  return `↓ ${base}`
}

export function workflowDurationMs(run: WorkflowRun, now = Date.now()): number {
  const started = Date.parse(run.startedAt ?? run.createdAt)
  const ended = run.completedAt ? Date.parse(run.completedAt) : now
  return Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : 0
}

export function summarizeWorkflowRuns(runs: WorkflowRun[]) {
  return runs.reduce((summary, run) => {
    if (run.status === 'running' || run.status === 'queued') summary.running++
    else if (run.status === 'paused') summary.paused++
    else if (run.status === 'completed') summary.completed++
    else if (run.status === 'cancelled') summary.stopped++
    else summary.failed++
    return summary
  }, { running: 0, paused: 0, completed: 0, stopped: 0, failed: 0 })
}

export function groupWorkflowRuns(runs: WorkflowRun[]): WorkflowGroup[] {
  return WORKFLOW_GROUPS.map(group => ({
    name: group.name,
    runs: runs.filter(run => group.statuses.includes(run.status)),
  }))
}

function asActivityItem(run: WorkflowRun, agents: SubagentState[], compact = false): WorkflowActivityItem {
  const preview = run.phase ?? run.meta.description ?? 'Dynamic Workflow'
  return {
    kind: 'workflow', id: run.runId, label: run.meta.name,
    description: compact ? `${run.status}${preview ? ` · ${preview}` : ''}` : preview,
    status: run.status, fixed: false, active: ['queued', 'running'].includes(run.status),
    startedAt: Date.parse(run.startedAt ?? run.createdAt) || Date.now(), run, agents,
  }
}

/** Reuse the Claude-style activity row instead of maintaining a second list design. */
export function formatWorkflowListRow(run: WorkflowRun, width: number, now = Date.now(), agents: SubagentState[] = [], selected = false): string {
  return formatActivityItem(asActivityItem(run, agents), width, now, selected ? '●' : '◯')
}

/** Flat mode adds the status to the same row format because it has no group heading. */
export function formatCompactWorkflowRow(run: WorkflowRun, width: number, now = Date.now(), agents: SubagentState[] = [], selected = false): string {
  return formatActivityItem(asActivityItem(run, agents, true), width, now, selected ? '●' : '◯')
}

export function formatWorkflowAgentRow(agent: SubagentState, width: number, now = Date.now()): string {
  const icons: Record<string, string> = { queued: '◌', running: '◯', blocked: 'Ⅱ', done: '✓', failed: '✘', error: '✘', cancelled: '✘', timed_out: '⌛' }
  const duration = agent.durationMs ?? Math.max(0, now - agent.startedAt)
  const label = agent.agentName && isFixedAgent(agent.agentName) ? getFixedAgent(agent.agentName).displayName : agent.agentName ?? 'Subagent'
  return truncate(`${icons[agent.status] ?? '•'} ${label} · ${agent.task} · ${formatDuration(duration)}${agent.tokens != null ? ` · ${formatTokens(agent.tokens)}` : ''}${agent.model ? ` · ${agent.model}` : ''}`, width)
}

const PANEL_AGENT_ICONS: Record<string, string> = { queued: '◌', running: '●', blocked: 'Ⅱ', done: '✓', failed: '✘', error: '✘', cancelled: '✘', timed_out: '⌛' }

function formatPanelTokens(tokens: number): string {
  return tokens >= 1_000 ? `${(tokens / 1_000).toFixed(1)}k tok` : `${tokens} tok`
}

/** Dense agent line used in the workflow's split phases/agents monitor. */
export function formatWorkflowPanelAgentRow(agent: SubagentState, width: number, now = Date.now()): string {
  const duration = agent.durationMs ?? Math.max(0, now - agent.startedAt)
  const details = agent.status === 'queued'
    ? [agent.model, 'queued'].filter(Boolean).join(' · ')
    : [agent.model, agent.tokens == null ? undefined : formatPanelTokens(agent.tokens), formatDuration(duration)].filter(Boolean).join(' · ')
  return truncate(`${PANEL_AGENT_ICONS[agent.status] ?? '•'} ${agent.task}  ${details || agent.status}`, width)
}

function workflowPhases(run: WorkflowRun): string[] {
  const phases = [...(run.phaseHistory ?? []), ...(run.phase ? [run.phase] : [])]
  return [...new Set(phases)]
}

function completedAgentCount(agents: SubagentState[]): number {
  return agents.filter(agent => !['queued', 'running', 'blocked'].includes(agent.status)).length
}

export function formatWorkflowPhaseRow(phase: string, index: number, current: boolean, completedAgents: number, totalAgents: number, width: number): string {
  return truncate(`${current ? '>' : ' '} ${index + 1} ${phase}${current ? ` ${completedAgents}/${totalAgents}` : ''}`, width)
}

export function windowWorkflowRuns(runs: WorkflowRun[], selected: number, maxRows: number): { runs: WorkflowRun[]; start: number } {
  const size = Math.max(1, maxRows)
  const start = Math.min(Math.max(0, selected - size + 1), Math.max(0, runs.length - size))
  return { runs: runs.slice(start, start + size), start }
}

export function workflowControlHint(status: WorkflowStatus): string {
  if (status === 'running') return 'x stop workflow · p pause · esc back · s save'
  if (status === 'paused') return 'x stop workflow · p resume · esc back · s save'
  if (status === 'queued') return 'x stop workflow · esc back · s save'
  return 'r restart workflow · esc back · s save'
}

function summaryText(runs: WorkflowRun[]): string {
  return groupWorkflowRuns(runs).map(group => `${group.runs.length} ${group.name.toLowerCase()}`).join(' · ')
}

export interface WorkflowMonitorProps {
  runs: WorkflowRun[]
  agents?: SubagentState[]
  initialRunId?: string
  theme?: ThemeName
  onClose(): void
  onPause(runId: string): Promise<boolean>
  onResume(runId: string): Promise<boolean>
  onStop(runId: string): Promise<boolean>
  onRestart(runId: string): Promise<void>
  onSave(runId: string, name: string): Promise<string>
}

export function WorkflowMonitor({
  runs, agents = [], initialRunId, theme = 'dark', onClose, onPause, onResume, onStop, onRestart, onSave,
}: WorkflowMonitorProps) {
  const colors = getThemeColors(theme)
  useClock()
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(() => runs.find(run => run.runId === initialRunId)?.runId ?? runs[0]?.runId)
  const [detail, setDetail] = useState(false)
  const [compact, setCompact] = useState(false)
  const [saveName, setSaveName] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const width = Math.max(30, (process.stdout.columns ?? 80) - 6)
  const height = process.stdout.rows ?? 24
  const now = Date.now()
  const groups = groupWorkflowRuns(runs)
  const displayedGroups = groups.filter(group => group.runs.length > 0)
  const orderedRuns = compact ? runs : groups.flatMap(group => group.runs)
  const selected = Math.max(0, orderedRuns.findIndex(run => run.runId === selectedRunId))
  const selectedRun = orderedRuns[selected]
  const selectedAgents = selectedRun ? agents.filter(agent => agent.workflowRunId === selectedRun.runId) : []
  const visible = windowWorkflowRuns(orderedRuns, selected, compact ? height - 5 : height - displayedGroups.length - 5)
  const visibleRunIds = new Set(visible.runs.map(run => run.runId))

  useEffect(() => {
    if (!runs.length) setSelectedRunId(undefined)
    else if (!runs.some(run => run.runId === selectedRunId)) setSelectedRunId(runs[0]!.runId)
  }, [runs, selectedRunId])

  useEffect(() => {
    if (initialRunId && runs.some(run => run.runId === initialRunId)) setSelectedRunId(initialRunId)
  }, [initialRunId, runs])

  useInput((input, key, event) => {
    event.stopImmediatePropagation()
    if (saveName === null && key.ctrl && input === 's') {
      setCompact(value => !value)
      return
    }
    if (saveName !== null) {
      if (key.escape) { setSaveName(null); return }
      if (key.backspace || key.delete) { setSaveName(value => value!.slice(0, -1)); return }
      if (key.return) {
        if (!selectedRun || !saveName.trim()) return
        void onSave(selectedRun.runId, saveName.trim())
          .then(path => { setFeedback(`Saved to ${path}`); setSaveName(null) })
          .catch(error => setFeedback((error as Error).message))
        return
      }
      if (!key.ctrl && !key.meta && input && !input.startsWith('\x1b')) setSaveName(value => value + input)
      return
    }
    if (key.escape) {
      if (detail) { setDetail(false); setFeedback('') } else onClose()
      return
    }
    if (!runs.length) return
    if (!detail && key.upArrow) { setSelectedRunId(orderedRuns[(selected - 1 + orderedRuns.length) % orderedRuns.length]!.runId); return }
    if (!detail && key.downArrow) { setSelectedRunId(orderedRuns[(selected + 1) % orderedRuns.length]!.runId); return }
    if (!detail && key.return) { setDetail(true); return }
    if (!selectedRun) return
    if (input === 'x' && ['queued', 'running', 'paused'].includes(selectedRun.status)) {
      void onStop(selectedRun.runId).then(ok => setFeedback(ok ? 'Workflow stopping.' : 'Workflow is not active.')).catch(error => setFeedback((error as Error).message))
    } else if (input === 'p' && selectedRun.status === 'running') {
      void onPause(selectedRun.runId).then(ok => setFeedback(ok ? 'Workflow paused.' : 'Workflow is not running.')).catch(error => setFeedback((error as Error).message))
    } else if (input === 'p' && selectedRun.status === 'paused') {
      void onResume(selectedRun.runId).then(ok => setFeedback(ok ? 'Workflow resumed.' : 'Workflow is not paused.')).catch(error => setFeedback((error as Error).message))
    } else if (input === 'r' && !['queued', 'running', 'paused'].includes(selectedRun.status)) {
      void onRestart(selectedRun.runId).catch(error => setFeedback((error as Error).message))
    } else if (input === 's') {
      setSaveName(selectedRun.meta.name)
    }
  })

  if (saveName !== null) {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text color={colors.primary}>{`Save workflow ${selectedRun?.runId.slice(0, 8) ?? ''}`}</Text>
        <Text>{`Name: ${saveName}█`}</Text>
        {feedback && <Text color={colors.error}>{truncate(feedback, width)}</Text>}
        <Text color={colors.textSubtle}>{'Enter save · Esc cancel'}</Text>
      </Box>
    )
  }

  if (detail && selectedRun) {
    const run = selectedRun
    const phases = workflowPhases(run)
    const completedAgents = completedAgentCount(selectedAgents)
    const phaseWidth = Math.min(26, Math.max(20, Math.floor(width * 0.22)))
    const panelHeight = Math.max(7, height - 5)
    const detailWidth = Math.max(12, width - phaseWidth - 5)
    const divider = Array.from({ length: Math.max(1, panelHeight - 2) }, () => '│').join('\n')
    const notes = [
      ...run.failures.map(failure => `✘ call ${failure.call} ${failure.method}: ${failure.message}`),
      ...run.worktrees.map(worktree => `⌘ ${worktree.taskId}: ${worktree.path}`),
      ...(run.error ? [run.error] : []),
      ...(feedback ? [feedback] : []),
      `↓ ${formatPanelTokens(run.usage.tokens)} · $${run.usage.costUsd.toFixed(4)}`,
      ...(run.options.maxTokens ? [`Token budget: ${run.usage.tokens}/${run.options.maxTokens}`] : []),
      ...(run.options.maxCostUsd !== undefined ? [`Cost budget: $${run.usage.costUsd.toFixed(4)}/$${run.options.maxCostUsd.toFixed(4)}`] : []),
    ]
    const agentLimit = Math.max(1, panelHeight - 3 - Math.min(notes.length, 2))
    const visibleAgents = selectedAgents.slice(0, agentLimit)
    const visibleNotes = notes.slice(0, Math.max(0, panelHeight - 3 - visibleAgents.length))
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text color={colors.primary} bold>{run.meta.name}</Text>
        <Box width={width} justifyContent="space-between">
          <Text color={colors.textDim}>{truncate(run.meta.description ?? 'Dynamic Workflow', Math.max(12, width - 24))}</Text>
          <Text color={colors.textDim}>{`${completedAgents}/${run.usage.agents} agents · ${formatDuration(workflowDurationMs(run, now))}`}</Text>
        </Box>
        <Box width={width} height={panelHeight} marginTop={1} borderStyle="round" borderColor={colors.textDim} flexDirection="row">
          <Box width={phaseWidth} flexShrink={0} flexDirection="column" paddingX={1}>
            <Text bold>{'Phases'}</Text>
            {phases.length === 0
              ? <Text color={colors.textSubtle}>{'◌ Waiting'}</Text>
              : phases.map((phase, index) => <Text key={`${index}-${phase}`} color={phase === run.phase ? colors.primary : colors.textDim}>
                {formatWorkflowPhaseRow(phase, index, phase === run.phase, completedAgents, run.usage.agents, Math.max(6, phaseWidth - 2))}
              </Text>)}
          </Box>
          <Text color={colors.textDim}>{divider}</Text>
          <Box flexGrow={1} flexDirection="column" paddingX={1}>
            <Text color={colors.primary} bold>{`${run.phase ?? run.status} · ${run.usage.agents} agents`}</Text>
            {visibleAgents.length === 0 && <Text color={colors.textSubtle}>{'No agents started.'}</Text>}
            {visibleAgents.map(agentRun => <Text key={agentRun.id} color={['failed', 'error', 'cancelled', 'timed_out'].includes(agentRun.status) ? colors.error : ['queued', 'running', 'blocked'].includes(agentRun.status) ? colors.primary : colors.textDim}>
              {formatWorkflowPanelAgentRow(agentRun, detailWidth, now)}
            </Text>)}
            {selectedAgents.length > visibleAgents.length && <Text color={colors.textSubtle}>{`… +${selectedAgents.length - visibleAgents.length} agents`}</Text>}
            {visibleNotes.map((note, index) => <Text key={`${index}-${note}`} color={note.startsWith('✘') || note === run.error ? colors.error : note === feedback ? colors.warning : colors.textDim}>{truncate(note, detailWidth)}</Text>)}
          </Box>
        </Box>
        <Text color={colors.textSubtle}>{workflowControlHint(run.status)}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text color={colors.primary}>{'● DeepSeek Code'}</Text>
      <Text color={colors.textSubtle}>{`  Workflows · ${summaryText(runs)}`}</Text>
      {runs.length === 0
        ? <Text color={colors.textDim}>{'No workflow runs in this session.'}</Text>
        : compact ? <>
          {visible.start > 0 && <Text color={colors.textSubtle}>{`  ↑ ${visible.start} earlier runs`}</Text>}
          {visible.runs.map((run, index) => {
            const actualIndex = visible.start + index
            const isSelected = actualIndex === selected
            return <Text key={run.runId} color={['failed', 'cancelled'].includes(run.status) ? colors.error : ['paused', 'timed_out', 'budget_exhausted'].includes(run.status) ? colors.warning : isSelected ? colors.primary : run.status === 'completed' ? colors.textDim : colors.text}>
              {`${isSelected ? '❯ ' : '  '}${formatCompactWorkflowRow(run, width - 2, now, agents.filter(agent => agent.workflowRunId === run.runId), isSelected)}`}
            </Text>
          })}
          {visible.start + visible.runs.length < runs.length && <Text color={colors.textSubtle}>{`  ↓ ${runs.length - visible.start - visible.runs.length} later runs`}</Text>}
        </> : <>
          {visible.start > 0 && <Text color={colors.textSubtle}>{`  ↑ ${visible.start} earlier runs`}</Text>}
          {displayedGroups.map(group => (
            <Box key={group.name} flexDirection="column">
              <Text color={colors.textSubtle}>{`  ${group.name} (${group.runs.length})`}</Text>
              {group.runs.filter(run => visibleRunIds.has(run.runId)).map(run => {
                const isSelected = run.runId === selectedRunId
                return <Text key={run.runId} color={['failed', 'cancelled'].includes(run.status) ? colors.error : ['paused', 'timed_out', 'budget_exhausted'].includes(run.status) ? colors.warning : isSelected ? colors.primary : run.status === 'completed' ? colors.textDim : colors.text}>
                  {`${isSelected ? '❯ ' : '  '}${formatWorkflowListRow(run, width - 2, now, agents.filter(agent => agent.workflowRunId === run.runId), isSelected)}`}
                </Text>
              })}
            </Box>
          ))}
          {visible.start + visible.runs.length < runs.length && <Text color={colors.textSubtle}>{`  ↓ ${runs.length - visible.start - visible.runs.length} later runs`}</Text>}
        </>}
      {feedback && <Text color={colors.warning}>{truncate(feedback, width)}</Text>}
      <Text color={colors.textSubtle}>{`↑/↓ to select · Enter to view · Ctrl+S ${compact ? 'grouped' : 'compact'} · x stop · p pause/resume · r restart · s save · Esc close`}</Text>
    </Box>
  )
}
