import { homedir } from 'os'
import type { SessionData } from '../../agent/session.js'
import type { SubagentStatus } from '../subagent/types.js'

/**
 * Command center rules, ported from Codex's agents overview (codex-rs/tui/src/app/agents_overview*.rs):
 * Needs you < Working < Ready < Inactive, subagents roll up into their session, tabs filter by status,
 * `g` cycles Project → Status → Model grouping. DeepSeek runs one live session per process, so only
 * the current session can be anything but Inactive.
 */
export type OverviewStatus = 'needs' | 'working' | 'ready' | 'inactive'
export type OverviewFilter = 'all' | OverviewStatus
export type OverviewGrouping = 'project' | 'status' | 'model'

export const STATUS_ORDER: OverviewStatus[] = ['needs', 'working', 'ready', 'inactive']
export const FILTERS: OverviewFilter[] = ['all', ...STATUS_ORDER]
export const GROUPINGS: OverviewGrouping[] = ['project', 'status', 'model']
export const FILTER_LABELS: Record<OverviewFilter, string> = { all: 'All', needs: 'Needs you', working: 'Working', ready: 'Ready', inactive: 'Inactive' }
/** The row's own wording; the tab says "Needs you", the row says what it is waiting for. */
export const STATUS_LABELS: Record<OverviewStatus, string> = { needs: 'Needs input', working: 'Working', ready: 'Ready', inactive: 'Inactive' }
export const GROUPING_LABELS: Record<OverviewGrouping, string> = { project: 'Project', status: 'Status', model: 'Model' }

export interface OverviewRow {
  id: string
  title: string
  cwd: string
  model: string
  updatedAt: number
  status: OverviewStatus
  current: boolean
  prompt: string
  lastMessage: string
  session: SessionData
}

/** Live status of the running session: anything waiting on the user wins, then any running work, else Ready; subagents count as part of it. */
export function liveStatus(state: { loading: boolean; waitingOnUser: boolean; subagents: SubagentStatus[] }): OverviewStatus {
  if (state.waitingOnUser || state.subagents.includes('blocked')) return 'needs'
  if (state.loading || state.subagents.some(status => status === 'running' || status === 'queued')) return 'working'
  return 'ready'
}

const firstLine = (text = '') => text.trim().split('\n')[0]!.trim()

function lastOf(session: SessionData, role: 'user' | 'assistant'): string {
  return session.uiMessages.findLast(message => message.role === role)?.content.trim() ?? ''
}

/** One row per session; the live one is marked current and carries the live status, every saved one is Inactive. */
export function buildRows(saved: SessionData[], current: { session: SessionData; status: OverviewStatus }): OverviewRow[] {
  const toRow = (session: SessionData, status: OverviewStatus, isCurrent: boolean): OverviewRow => {
    const prompt = session.uiMessages.find(message => message.role === 'user')?.content.trim() ?? ''
    return {
      id: session.id,
      title: firstLine(session.title) || firstLine(prompt) || 'Untitled task',
      cwd: session.cwd,
      model: session.model || 'Unknown',
      updatedAt: Date.parse(session.updatedAt) || 0,
      status,
      current: isCurrent,
      prompt,
      lastMessage: lastOf(session, 'assistant'),
      session,
    }
  }
  return [
    toRow(current.session, current.status, true),
    ...saved.filter(session => session.id !== current.session.id).map(session => toRow(session, 'inactive', false)),
  ]
}

/** `~/code/app` for paths under the home directory. */
export function displayCwd(cwd: string, home = homedir()): string {
  return cwd === home ? '~' : cwd.startsWith(home + '/') ? '~' + cwd.slice(home.length) : cwd
}

export function groupLabel(row: OverviewRow, grouping: OverviewGrouping): string {
  if (grouping === 'status') return STATUS_LABELS[row.status]
  if (grouping === 'model') return row.model
  return displayCwd(row.cwd)
}

/** Per-tab counts over every row, ignoring the search, as Codex does. */
export function filterCounts(rows: OverviewRow[]): Record<OverviewFilter, number> {
  const counts = { all: rows.length, needs: 0, working: 0, ready: 0, inactive: 0 }
  for (const row of rows) counts[row.status]++
  return counts
}

/** Rows shown for a tab and search, sorted so each group is contiguous and newest first inside it. */
export function visibleRows(rows: OverviewRow[], options: { filter: OverviewFilter; grouping: OverviewGrouping; search: string }): OverviewRow[] {
  const query = options.search.trim().toLowerCase()
  const rank = (row: OverviewRow) => options.grouping === 'status' ? String(STATUS_ORDER.indexOf(row.status)) : groupLabel(row, options.grouping)
  return rows
    .filter(row => options.filter === 'all' || row.status === options.filter)
    .filter(row => !query || `${row.title}\n${row.prompt}\n${row.cwd}`.toLowerCase().includes(query))
    .sort((a, b) => rank(a).localeCompare(rank(b)) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
}

/** `now`, `12s ago`, `5m ago`, `3h ago`, `2d ago`; `-` without a timestamp. */
export function relativeAge(updatedAt: number, now = Date.now()): string {
  if (!updatedAt) return '-'
  const seconds = Math.max(0, Math.floor((now - updatedAt) / 1000))
  if (seconds < 5) return 'now'
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86_400)}d ago`
}
