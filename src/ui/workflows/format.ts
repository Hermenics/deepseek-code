import type { WorkflowRun, WorkflowStatus } from '../../workflows/types.js'
import type { SubagentState } from '../subagent/types.js'

/** Claude Code renders one glyph per run status in the `/workflows` list. */
const RUN_ICONS: Record<WorkflowStatus, string> = {
  queued: '⟳', running: '⟳', paused: '⏸', completed: '✔',
  failed: '✘', cancelled: '✘', timed_out: '⌛', budget_exhausted: '⌛',
}

const AGENT_ICONS: Record<string, string> = {
  queued: '◌', running: '●', blocked: 'Ⅱ', done: '✔',
  failed: '✘', error: '✘', cancelled: '✘', timed_out: '⌛',
}

const ACTIVE_RUNS: ReadonlySet<WorkflowStatus> = new Set<WorkflowStatus>(['queued', 'running', 'paused'])
const ACTIVE_AGENTS: ReadonlySet<string> = new Set(['queued', 'running', 'blocked'])

/** Status buckets in the order Claude Code prints them in the list subtitle. */
const SUMMARY_ORDER: ReadonlyArray<{ label: string; statuses: readonly WorkflowStatus[] }> = [
  { label: 'running', statuses: ['queued', 'running'] },
  { label: 'paused', statuses: ['paused'] },
  { label: 'completed', statuses: ['completed'] },
  { label: 'stopped', statuses: ['cancelled'] },
  { label: 'failed', statuses: ['failed', 'timed_out', 'budget_exhausted'] },
]

export function runIcon(status: WorkflowStatus): string {
  return RUN_ICONS[status] ?? '•'
}

export function agentIcon(status: string): string {
  return AGENT_ICONS[status] ?? '•'
}

export function isRunActive(status: WorkflowStatus): boolean {
  return ACTIVE_RUNS.has(status)
}

export function isAgentActive(status: string): boolean {
  return ACTIVE_AGENTS.has(status)
}

export function truncate(value: string, width: number): string {
  if (width <= 0) return ''
  return value.length <= width ? value : `${value.slice(0, Math.max(0, width - 1))}…`
}

/** `45s` under a minute, `1m 6s` above it — the list format. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

/** The detail header drops the space: `1m18s`. */
export function formatCompactDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}m`
  if (tokens >= 1_000) {
    const thousands = tokens / 1_000
    // Claude Code drops the decimal once it is a round thousand (`113k`, not `113.0k`).
    return Number.isInteger(thousands) ? `${thousands}k` : `${thousands.toFixed(1)}k`
  }
  return `${tokens}`
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

/** `3 running · 2 completed` — only non-empty buckets appear. */
export function workflowSummaryLine(runs: WorkflowRun[]): string {
  return SUMMARY_ORDER
    .map(bucket => ({ label: bucket.label, count: runs.filter(run => bucket.statuses.includes(run.status)).length }))
    .filter(bucket => bucket.count > 0)
    .map(bucket => `${bucket.count} ${bucket.label}`)
    .join(' · ')
}

/** List row: `⟳ essay-check  6 agents · 339k tok · 1m 6s`. */
export function formatWorkflowRunRow(run: WorkflowRun, width: number, now = Date.now()): string {
  const stats = `${run.usage.agents} agent${run.usage.agents === 1 ? '' : 's'} · ${formatTokens(run.usage.tokens)} tok · ${formatDuration(workflowDurationMs(run, now))}`
  return truncate(`${runIcon(run.status)} ${run.meta.name}  ${stats}`, width)
}

/** Header stats: `6/6 agents · 1m23s · done` — the suffix only lands once the run settles. */
export function formatWorkflowHeaderStats(run: WorkflowRun, agents: SubagentState[], now = Date.now()): string {
  const done = agents.filter(agent => !isAgentActive(agent.status)).length
  const total = Math.max(run.usage.agents, agents.length)
  const base = `${done}/${total} agents · ${formatCompactDuration(workflowDurationMs(run, now))}`
  if (isRunActive(run.status)) return base
  return `${base} · ${run.status === 'completed' ? 'done' : run.status}`
}

export type PhaseState = 'done' | 'active' | 'pending'

/**
 * Phase row, matching Claude Code exactly:
 * done → `✔ Phase 1 2/2`, active → `1 Phase 1 0/2`, pending → `2 Phase 2` (no counter).
 * The counter is right-aligned inside the column.
 */
export function formatWorkflowPhaseRow(
  phase: string, index: number, state: PhaseState, done: number, total: number, width: number,
): string {
  const icon = state === 'done' ? '✔' : `${index + 1}`
  const label = `${icon} ${phase}`
  if (state === 'pending') return truncate(label, width)
  const counter = `${done}/${total}`
  const gap = Math.max(1, width - label.length - counter.length)
  return truncate(`${label}${' '.repeat(gap)}${counter}`, width)
}

/** Agent row in the phase panel: `● p1-red    model · 56.5k tok` with the duration right-aligned. */
export function formatWorkflowPanelAgentRow(
  agent: SubagentState, width: number, now = Date.now(), labelWidth = 0,
): string {
  const duration = formatDuration(agent.durationMs ?? Math.max(0, now - agent.startedAt))
  // Workflows that skip `label` hand us the whole prompt, so clamp it or it swallows the panel.
  const label = truncate(agent.task || 'agent', Math.max(8, labelWidth)).padEnd(labelWidth)
  const details = agent.status === 'queued'
    ? [agent.model, 'queued'].filter(Boolean).join(' · ')
    : [agent.model, agent.tokens == null ? undefined : `${formatTokens(agent.tokens)} tok`].filter(Boolean).join(' · ')
  const left = `${agentIcon(agent.status)} ${label}  ${details}`
  const gap = Math.max(1, width - left.length - duration.length)
  return truncate(`${left}${' '.repeat(gap)}${duration}`, width)
}

/** Contextual hint for the run list; `x to stop` only shows for an active selection. */
export function workflowListHint(status: WorkflowStatus | undefined): string {
  const actions = ['↑/↓ to select', 'Enter to view']
  if (status && isRunActive(status)) actions.push('x to stop')
  actions.push('s to save', 'Esc to close')
  return actions.join(' · ')
}

export function workflowControlHint(status: WorkflowStatus): string {
  return workflowListHint(status)
}

export function windowRows<T>(rows: T[], selected: number, maxRows: number): { rows: T[]; start: number } {
  const size = Math.max(1, maxRows)
  const start = Math.min(Math.max(0, selected - size + 1), Math.max(0, rows.length - size))
  return { rows: rows.slice(start, start + size), start }
}

/**
 * Ordered phases for a run. The declared `meta.phases` skeleton comes first so phases that
 * have not started yet still render as pending, then any phase the runtime announced on its own.
 */
export function workflowPhases(run: WorkflowRun): string[] {
  return [...new Set([
    ...(run.meta.phases ?? []).map(phase => phase.title),
    ...(run.phaseHistory ?? []),
    ...(run.phase ? [run.phase] : []),
  ])]
}

/**
 * Agents belonging to a phase. When the runtime never tagged agents with a phase
 * (replayed runs, older journals) they are parked on the live phase instead of vanishing.
 */
export function agentsInPhase(
  agents: SubagentState[], phase: string, phases: string[], currentPhase?: string,
): SubagentState[] {
  const tagged = agents.filter(agent => agent.workflowPhase === phase)
  if (tagged.length) return tagged
  if (agents.some(agent => agent.workflowPhase)) return []
  return phases.length <= 1 || phase === currentPhase ? agents : []
}

/**
 * Width the phase column needs: Claude Code sizes it to its contents rather than a fixed
 * column, so `Alpha 2/2` stays tight while `Specification 10/10` still fits.
 */
export function phaseColumnWidth(rows: Array<{ phase: string; index: number; counter: string }>): number {
  const widest = Math.max(0, ...rows.map(row => `${row.index + 1} ${row.phase}`.length + (row.counter ? row.counter.length + 1 : 0)))
  return Math.min(30, Math.max(11, widest))
}

/**
 * Live agents decide the state when we have them. Without them — a run restored from an
 * earlier session — the recorded history is what distinguishes a phase that already ran
 * from one that never started; otherwise every past phase would render as pending.
 */
export function phaseStateOf(phase: string, run: WorkflowRun, agents: SubagentState[]): PhaseState {
  if (agents.length) return agents.every(agent => !isAgentActive(agent.status)) ? 'done' : 'active'
  const reached = run.phase === phase || (run.phaseHistory?.includes(phase) ?? false)
  if (!reached) return 'pending'
  // A settled run has no active phase, so everything it reached is done.
  return isRunActive(run.status) && run.phase === phase ? 'active' : 'done'
}
