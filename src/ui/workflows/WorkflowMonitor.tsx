import { useEffect, useState } from 'react'
import useInput from '../../ink/hooks/use-input.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import type { WorkflowRun, WorkflowStatus } from '../../workflows/types.js'
import { getThemeColors, type ThemeName } from '../theme.js'
import { useClock } from '../clock.js'
import type { SubagentState } from '../subagent/types.js'
import { getFixedAgent, isFixedAgent } from '../../tools/SubAgent/fixedAgents.js'

const ICONS: Record<WorkflowStatus, string> = {
  queued: '◌', running: '⟳', paused: '⏸', completed: '✔', failed: '✘',
  cancelled: '✘', timed_out: '⌛', budget_exhausted: '⚠',
}

function truncate(value: string, width: number): string {
  return value.length <= width ? value : `${value.slice(0, Math.max(0, width - 1))}…`
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function formatTokens(tokens: number): string {
  return tokens >= 1_000 ? `${(tokens / 1_000).toFixed(1)}k tok` : `${tokens} tok`
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

export function formatWorkflowListRow(run: WorkflowRun, width: number, now = Date.now(), agents?: SubagentState[]): string {
  const phase = run.phase ? ` · ${run.phase}` : ''
  const done = agents?.filter(agent => !['queued', 'running', 'blocked'].includes(agent.status)).length
  const progress = done === undefined ? `${run.usage.agents} agents` : `${done}/${run.usage.agents} agents done`
  const row = `${ICONS[run.status]} ${run.meta.name}${phase}  ${progress} · ${formatTokens(run.usage.tokens)} · ${formatDuration(workflowDurationMs(run, now))}`
  return truncate(row, width)
}

export function formatWorkflowAgentRow(agent: SubagentState, width: number, now = Date.now()): string {
  const icons: Record<string, string> = { queued: '◌', running: '◯', blocked: 'Ⅱ', done: '✓', failed: '✘', error: '✘', cancelled: '✘', timed_out: '⌛' }
  const duration = agent.durationMs ?? Math.max(0, now - agent.startedAt)
  const label = agent.agentName && isFixedAgent(agent.agentName) ? getFixedAgent(agent.agentName).displayName : agent.agentName ?? 'Subagent'
  return truncate(`${icons[agent.status] ?? '•'} ${label} · ${agent.task} · ${formatDuration(duration)}${agent.tokens != null ? ` · ${formatTokens(agent.tokens)}` : ''}${agent.model ? ` · ${agent.model}` : ''}`, width)
}

export function windowWorkflowRuns(runs: WorkflowRun[], selected: number, maxRows: number): { runs: WorkflowRun[]; start: number } {
  const size = Math.max(1, maxRows)
  const start = Math.min(Math.max(0, selected - size + 1), Math.max(0, runs.length - size))
  return { runs: runs.slice(start, start + size), start }
}

export function workflowControlHint(status: WorkflowStatus): string {
  if (status === 'running') return 'Esc back · x stop · p pause · s save'
  if (status === 'paused') return 'Esc back · x stop · p resume · s save'
  if (status === 'queued') return 'Esc back · x stop · s save'
  return 'Esc back · r restart · s save'
}

function summaryText(runs: WorkflowRun[]): string {
  const counts = summarizeWorkflowRuns(runs)
  const parts = Object.entries(counts).filter(([, count]) => count > 0).map(([name, count]) => `${count} ${name}`)
  return parts.join(' · ') || 'No workflow runs'
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
  const [selected, setSelected] = useState(() => Math.max(0, runs.findIndex(run => run.runId === initialRunId)))
  const [detail, setDetail] = useState(Boolean(initialRunId))
  const [saveName, setSaveName] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const width = Math.max(30, (process.stdout.columns ?? 80) - 6)
  const height = process.stdout.rows ?? 24
  const now = Date.now()
  const selectedRun = runs[selected]
  const selectedAgents = selectedRun ? agents.filter(agent => agent.workflowRunId === selectedRun.runId) : []
  const visible = windowWorkflowRuns(runs, selected, height - 6)

  useEffect(() => {
    if (!runs.length) setSelected(0)
    else if (selected >= runs.length) setSelected(runs.length - 1)
  }, [runs.length, selected])

  useInput((input, key, event) => {
    event.stopImmediatePropagation()
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
    if (!detail && key.upArrow) { setSelected(value => (value - 1 + runs.length) % runs.length); return }
    if (!detail && key.downArrow) { setSelected(value => (value + 1) % runs.length); return }
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
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text color={colors.primary} bold>{`${ICONS[run.status]} ${run.meta.name}`}</Text>
        <Text color={colors.textDim}>{truncate(run.meta.description ?? 'Dynamic Workflow', width)}</Text>
        <Text>{`${run.status}${run.phase ? ` · ${run.phase}` : ''} · ${formatDuration(workflowDurationMs(run, now))}`}</Text>
        <Text>{`${run.usage.agents} agents · ${formatTokens(run.usage.tokens)} · $${run.usage.costUsd.toFixed(4)}`}</Text>
        {selectedAgents.slice(0, Math.max(1, height - 10)).map(agentRun => (
          <Text key={agentRun.id} color={['failed', 'error', 'cancelled', 'timed_out'].includes(agentRun.status) ? colors.error : ['queued', 'running', 'blocked'].includes(agentRun.status) ? colors.primary : colors.textDim}>
            {formatWorkflowAgentRow(agentRun, width, now)}
          </Text>
        ))}
        {selectedAgents.length > Math.max(1, height - 10) && <Text color={colors.textSubtle}>{`… +${selectedAgents.length - Math.max(1, height - 10)} agents`}</Text>}
        {run.options.maxTokens && <Text color={colors.textDim}>{`Token budget: ${run.usage.tokens}/${run.options.maxTokens}`}</Text>}
        {run.options.maxCostUsd !== undefined && <Text color={colors.textDim}>{`Cost budget: $${run.usage.costUsd.toFixed(4)}/$${run.options.maxCostUsd.toFixed(4)}`}</Text>}
        {run.failures.map(failure => <Text key={`${failure.call}-${failure.method}`} color={colors.error}>{truncate(`✘ call ${failure.call} ${failure.method}: ${failure.message}`, width)}</Text>)}
        {run.worktrees.map(worktree => <Text key={worktree.taskId} color={colors.textDim}>{truncate(`⌘ ${worktree.taskId}: ${worktree.path}`, width)}</Text>)}
        {run.error && <Text color={colors.error}>{truncate(run.error, width)}</Text>}
        {feedback && <Text color={colors.warning}>{truncate(feedback, width)}</Text>}
        <Text color={colors.textSubtle}>{workflowControlHint(run.status)}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" paddingX={2}>
      <Text color={colors.primary} bold>{'Dynamic Workflows'}</Text>
      <Text color={colors.textSubtle}>{summaryText(runs)}</Text>
      {runs.length === 0
        ? <Text color={colors.textDim}>{'No workflow runs in this session.'}</Text>
        : <>
          {visible.start > 0 && <Text color={colors.textSubtle}>{`  ↑ ${visible.start} earlier runs`}</Text>}
          {visible.runs.map((run, index) => {
            const actualIndex = visible.start + index
            return <Text key={run.runId} color={actualIndex === selected ? colors.primary : colors.textDim}>
              {`${actualIndex === selected ? '❯' : ' '} ${formatWorkflowListRow(run, width - 2, now, agents.filter(agent => agent.workflowRunId === run.runId))}`}
            </Text>
          })}
          {visible.start + visible.runs.length < runs.length && <Text color={colors.textSubtle}>{`  ↓ ${runs.length - visible.start - visible.runs.length} later runs`}</Text>}
        </>}
      {feedback && <Text color={colors.warning}>{truncate(feedback, width)}</Text>}
      <Text color={colors.textSubtle}>{'↑/↓ select · Enter view · x stop · p pause/resume · r restart · s save · Esc close'}</Text>
    </Box>
  )
}
