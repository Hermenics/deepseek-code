import { useEffect, useRef, useState } from 'react'
import useInput from '../../ink/hooks/use-input.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import type { WorkflowRun } from '../../workflows/types.js'
import { getThemeColors, type ThemeName } from '../theme.js'
import { useClock } from '../clock.js'
import type { SubagentState } from '../subagent/types.js'
import {
  agentIcon, agentsInPhase, formatCompactDuration, formatDuration, formatTokens,
  formatWorkflowHeaderStats, formatWorkflowPanelAgentRow, formatWorkflowPhaseRow, formatWorkflowRunRow,
  isAgentActive, isRunActive, phaseColumnWidth, phaseStateOf, runIcon, truncate, windowRows, workflowDurationMs,
  workflowListHint, workflowPhases, workflowSummaryLine,
} from './format.js'

export * from './format.js'

/** Draws `╭ Phases ──────┬ Alpha · 2 agents ─────╮` with both column titles inside the border. */
function boxTop(leftTitle: string, leftWidth: number, rightTitle: string, rightWidth: number): string {
  const cell = (title: string, width: number) => {
    const label = truncate(title, Math.max(1, width - 2))
    return ` ${label} ${'─'.repeat(Math.max(0, width - label.length - 2))}`
  }
  return `╭${cell(leftTitle, leftWidth)}┬${cell(rightTitle, rightWidth)}╮`
}

/** Bottom border, optionally carrying a right-aligned note such as `1–44 of 46 ↓`. */
function boxBottom(leftWidth: number, rightWidth: number, note?: string): string {
  const right = note
    ? `${'─'.repeat(Math.max(0, rightWidth - note.length - 3))}  ${note} `
    : '─'.repeat(rightWidth)
  return `╰${'─'.repeat(leftWidth)}┴${right}╯`
}

/** Both cells are truncated as well as padded, so an over-long label cannot push the borders apart. */
function boxRow(left: string, leftWidth: number, right: string, rightWidth: number): string {
  const cell = (value: string, width: number) => truncate(value, width).padEnd(width)
  return `│ ${cell(left, Math.max(0, leftWidth - 2))} │${cell(right, rightWidth)}│`
}

/** Hard-wraps a paragraph so long agent output stays inside the panel. */
function wrapText(value: string, width: number): string[] {
  const lines: string[] = []
  for (const raw of value.split('\n')) {
    if (!raw.length) { lines.push(''); continue }
    for (let index = 0; index < raw.length; index += width) lines.push(raw.slice(index, index + width))
  }
  return lines
}

/** Transcript body for the agent drill-down, mirroring Claude Code's `Prompt` section. */
function agentTranscript(agent: SubagentState, width: number, now: number): string[] {
  const duration = formatDuration(agent.durationMs ?? Math.max(0, now - agent.startedAt))
  const status = agent.status === 'done' ? 'Completed' : agent.status.charAt(0).toUpperCase() + agent.status.slice(1)
  const metrics = [agent.tokens == null ? undefined : `${formatTokens(agent.tokens)} tok`, duration].filter(Boolean).join(' · ')
  return [
    `${agentIcon(agent.status)} ${status}${agent.model ? ` · ${agent.model}` : ''}`,
    metrics,
    '',
    'Prompt',
    // `task` is the short label here; fall back to it for runs spawned before prompts were kept.
    ...wrapText(agent.prompt ?? agent.task, Math.max(8, width - 2)).map(line => `  ${line}`),
    ...(agent.result ? ['', ...wrapText(agent.result, width)] : []),
    ...(agent.error ? ['', `✘ ${truncate(agent.error, width - 2)}`] : []),
  ]
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
  // Opening from the activity footer names a run, so it lands straight on that run's detail.
  const [view, setView] = useState<'list' | 'run' | 'agent'>(initialRunId ? 'run' : 'list')
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(() => initialRunId ?? runs[0]?.runId)
  const [phaseIndex, setPhaseIndex] = useState(0)
  const [agentIndex, setAgentIndex] = useState(0)
  const [scroll, setScroll] = useState(0)
  const [saveName, setSaveName] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const appliedRunId = useRef<string | undefined>(undefined)

  const width = Math.max(30, (process.stdout.columns ?? 80) - 6)
  const height = process.stdout.rows ?? 24
  const now = Date.now()
  const selected = Math.max(0, runs.findIndex(run => run.runId === selectedRunId))
  const run = runs[selected]
  const runAgents = run ? agents.filter(agent => agent.workflowRunId === run.runId) : []
  const phases = run ? workflowPhases(run) : []
  const phase = phases[Math.min(phaseIndex, Math.max(0, phases.length - 1))]
  const phaseAgents = run && phase ? agentsInPhase(runAgents, phase, phases, run.phase) : runAgents
  const agent = phaseAgents[Math.min(agentIndex, Math.max(0, phaseAgents.length - 1))]

  useEffect(() => {
    if (!runs.length) { setSelectedRunId(undefined); return }
    if (!runs.some(item => item.runId === selectedRunId)) setSelectedRunId(runs[0]!.runId)
  }, [runs, selectedRunId])

  // `runs` changes on every manager event, so this must fire once per initialRunId —
  // otherwise a live workflow keeps yanking the view back to that run while you navigate.
  useEffect(() => {
    if (!initialRunId || appliedRunId.current === initialRunId) return
    if (!runs.some(item => item.runId === initialRunId)) return
    appliedRunId.current = initialRunId
    setSelectedRunId(initialRunId)
    setView('run')
  }, [initialRunId, runs])

  useInput((input, key, event) => {
    event.stopImmediatePropagation()
    if (saveName !== null) {
      if (key.escape) { setSaveName(null); return }
      if (key.backspace || key.delete) { setSaveName(value => value!.slice(0, -1)); return }
      if (key.return) {
        if (!run || !saveName.trim()) return
        void onSave(run.runId, saveName.trim())
          .then(path => { setFeedback(`Saved to ${path}`); setSaveName(null) })
          .catch(error => setFeedback((error as Error).message))
        return
      }
      if (!key.ctrl && !key.meta && input && !input.startsWith('\x1b')) setSaveName(value => value + input)
      return
    }
    if (key.escape) {
      if (view === 'agent') { setView('run'); setScroll(0) }
      else if (view === 'run') { setView('list'); setFeedback('') }
      else onClose()
      return
    }
    if (!runs.length || !run) return
    if (input === 's') { setSaveName(run.meta.name); return }

    if (view === 'list') {
      if (key.upArrow) { setSelectedRunId(runs[(selected - 1 + runs.length) % runs.length]!.runId); return }
      if (key.downArrow) { setSelectedRunId(runs[(selected + 1) % runs.length]!.runId); return }
      if (key.return) { setView('run'); setPhaseIndex(0); return }
      if (input === 'x' && isRunActive(run.status)) {
        void onStop(run.runId).then(ok => setFeedback(ok ? 'Workflow stopping.' : 'Workflow is not active.')).catch(error => setFeedback((error as Error).message))
      } else if (input === 'p' && run.status === 'running') {
        void onPause(run.runId).then(ok => setFeedback(ok ? 'Workflow paused.' : 'Workflow is not running.')).catch(error => setFeedback((error as Error).message))
      } else if (input === 'p' && run.status === 'paused') {
        void onResume(run.runId).then(ok => setFeedback(ok ? 'Workflow resumed.' : 'Workflow is not paused.')).catch(error => setFeedback((error as Error).message))
      } else if (input === 'r' && !isRunActive(run.status)) {
        void onRestart(run.runId).catch(error => setFeedback((error as Error).message))
      }
      return
    }

    if (view === 'run') {
      if (key.upArrow && phases.length) { setPhaseIndex((phaseIndex - 1 + phases.length) % phases.length); return }
      if (key.downArrow && phases.length) { setPhaseIndex((phaseIndex + 1) % phases.length); return }
      if (key.return && phaseAgents.length) { setView('agent'); setAgentIndex(0); setScroll(0) }
      return
    }

    if (key.upArrow && phaseAgents.length) { setAgentIndex((agentIndex - 1 + phaseAgents.length) % phaseAgents.length); setScroll(0); return }
    if (key.downArrow && phaseAgents.length) { setAgentIndex((agentIndex + 1) % phaseAgents.length); setScroll(0); return }
    if (input === 'j') setScroll(value => value + 1)
    else if (input === 'k') setScroll(value => Math.max(0, value - 1))
  })

  if (saveName !== null) {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text color={colors.primary}>{`Save workflow ${run?.runId.slice(0, 8) ?? ''}`}</Text>
        <Text>{`Name: ${saveName}█`}</Text>
        {feedback && <Text color={colors.error}>{truncate(feedback, width)}</Text>}
        <Text color={colors.textSubtle}>{'Enter save · Esc cancel'}</Text>
      </Box>
    )
  }

  if (view !== 'list' && run) {
    const panelHeight = Math.max(6, height - 9)
    const isAgentView = view === 'agent'
    const leftRows = isAgentView
      ? phaseAgents.map((item, index) => `${index === agentIndex ? '❯' : ' '} ${agentIcon(item.status)} ${item.task}`)
      : (() => {
        const cells = phases.map((item, index) => {
          const items = agentsInPhase(runAgents, item, phases, run.phase)
          const done = items.filter(entry => !isAgentActive(entry.status)).length
          const total = items.length || (run.phase === item ? Math.max(1, run.usage.agents) : 0)
          const state = phaseStateOf(item, run, items)
          return { phase: item, index, state, done, total, counter: state === 'pending' ? '' : `${done}/${total}` }
        })
        const phaseWidth = phaseColumnWidth(cells)
        return cells.map(cell =>
          `${cell.index === phaseIndex ? '❯' : ' '} ${formatWorkflowPhaseRow(cell.phase, cell.index, cell.state, cell.done, cell.total, phaseWidth)}`)
      })()
    const leftWidth = Math.min(34, Math.max(12, Math.max(0, ...leftRows.map(row => row.length)) + 2))
    const rightWidth = Math.max(12, width - leftWidth - 3)
    const labelWidth = Math.min(20, Math.max(0, ...phaseAgents.map(item => item.task.length)))
    const body = isAgentView && agent
      ? agentTranscript(agent, rightWidth - 2, now).map(line => ` ${line}`)
      : phaseAgents.map(item => `  ${formatWorkflowPanelAgentRow(item, rightWidth - 3, now, labelWidth)}`)
    // Keep the selected phase/agent on screen once the list outgrows the panel.
    const activeIndex = isAgentView ? agentIndex : phaseIndex
    const leftWindow = windowRows(leftRows, activeIndex, panelHeight)
    // `j` increments freely, so clamp before slicing or the panel scrolls past the end.
    const scrollOffset = Math.min(scroll, Math.max(0, body.length - panelHeight))
    const visibleBody = body.slice(scrollOffset, scrollOffset + panelHeight)
    const note = isAgentView && body.length > panelHeight
      ? `${scrollOffset + 1}–${Math.min(body.length, scrollOffset + panelHeight)} of ${body.length} ↓`
      : undefined
    const rightTitle = isAgentView ? agent?.task ?? 'Agent' : `${phase ?? 'Waiting'} · ${phaseAgents.length} agent${phaseAgents.length === 1 ? '' : 's'}`
    const leftTitle = isAgentView ? `${phase ?? 'Phase'} · ${phaseAgents.length} agents` : 'Phases'

    return (
      <Box flexDirection="column">
        <Text color={colors.textDim}>{`  ${'─'.repeat(width)}`}</Text>
        <Text color={colors.primary} bold>{`   ${truncate(run.meta.name, width)}`}</Text>
        <Text color={colors.textDim}>
          {`   ${truncate(run.meta.description ?? 'Dynamic Workflow', Math.max(12, width - 30)).padEnd(Math.max(12, width - 28))}${formatWorkflowHeaderStats(run, runAgents, now)}`}
        </Text>
        <Text>{' '}</Text>
        <Text color={colors.textDim}>{`   ${boxTop(leftTitle, leftWidth, rightTitle, rightWidth)}`}</Text>
        {Array.from({ length: panelHeight }, (_, index) => {
          const left = leftWindow.rows[index] ?? ''
          const right = visibleBody[index] ?? ''
          const active = leftWindow.start + index === activeIndex
          return (
            <Text key={index} color={index < leftWindow.rows.length && active ? colors.primary : colors.textDim}>
              {`   ${boxRow(left, leftWidth, right, rightWidth)}`}
            </Text>
          )
        })}
        <Text color={colors.textDim}>{`   ${boxBottom(leftWidth, rightWidth, note)}`}</Text>
        {feedback && <Text color={colors.warning}>{`   ${truncate(feedback, width)}`}</Text>}
        <Text color={colors.textSubtle}>
          {isAgentView ? '   ↑↓ agent · j/k scroll · esc back · s save' : '   ↑↓ select · esc back · s save'}
        </Text>
      </Box>
    )
  }

  const visible = windowRows(runs, selected, Math.max(3, height - 8))
  return (
    <Box flexDirection="column">
      <Text color={colors.text} bold>{'   Dynamic workflows'}</Text>
      {runs.length > 0 && <Text color={colors.textSubtle}>{`   ${workflowSummaryLine(runs)}`}</Text>}
      <Text>{' '}</Text>
      {runs.length === 0
        ? <Text color={colors.textDim}>{'   No dynamic workflows in this session.'}</Text>
        : <>
          {visible.start > 0 && <Text color={colors.textSubtle}>{`   ↑ ${visible.start} earlier runs`}</Text>}
          {visible.rows.map((item, index) => {
            const isSelected = visible.start + index === selected
            return (
              <Text key={item.runId} color={['failed', 'cancelled'].includes(item.status) ? colors.error : isSelected ? colors.primary : colors.textDim}>
                {`   ${isSelected ? '❯ ' : '  '}${formatWorkflowRunRow(item, width - 5, now)}`}
              </Text>
            )
          })}
          {visible.start + visible.rows.length < runs.length && <Text color={colors.textSubtle}>{`   ↓ ${runs.length - visible.start - visible.rows.length} later runs`}</Text>}
        </>}
      <Text>{' '}</Text>
      {feedback && <Text color={colors.warning}>{`   ${truncate(feedback, width)}`}</Text>}
      <Text color={colors.textSubtle}>{`   ${runs.length ? workflowListHint(run?.status) : 'Esc to close'}`}</Text>
    </Box>
  )
}

/** Kept for the activity footer, which still renders workflow rows in the compact list. */
export function formatWorkflowListRow(run: WorkflowRun, width: number, now = Date.now()): string {
  return formatWorkflowRunRow(run, width, now)
}

export function formatCompactWorkflowRow(run: WorkflowRun, width: number, now = Date.now()): string {
  return truncate(`${runIcon(run.status)} ${run.meta.name} · ${run.status} · ${formatCompactDuration(workflowDurationMs(run, now))}`, width)
}
