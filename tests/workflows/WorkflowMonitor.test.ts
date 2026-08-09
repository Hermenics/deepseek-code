import { describe, expect, test } from 'bun:test'
import {
  agentsInPhase,
  formatCompactWorkflowRow,
  formatWorkflowHeaderStats,
  formatWorkflowPanelAgentRow,
  formatWorkflowPhaseRow,
  formatWorkflowRunRow,
  phaseStateOf,
  summarizeWorkflowRuns,
  windowRows,
  workflowDurationMs,
  workflowListHint,
  workflowPhases,
  workflowSummaryLine,
} from '../../src/ui/workflows/WorkflowMonitor.js'
import type { WorkflowRun } from '../../src/workflows/types.js'
import type { SubagentState } from '../../src/ui/subagent/types.js'

function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    runId: '12345678-abcd', sessionId: 'session', projectRoot: '/project',
    meta: { name: 'audit' }, status: 'running', scriptHash: 'script', argsHash: 'args',
    optionsHash: 'options', options: {}, createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z', usage: { agents: 2, tokens: 4000, costUsd: 0 },
    failures: [], worktrees: [], ...overrides,
  }
}

function agent(overrides: Partial<SubagentState> = {}): SubagentState {
  return {
    id: 'agent-1', task: 'review', status: 'done', colorIndex: 0, toolCount: 1,
    lastToolInfo: null, startedAt: Date.parse('2026-01-01T00:00:00.000Z'), durationMs: 3_000,
    result: 'ok', error: null, tokens: 1200, costUsd: 0.01, role: 'reviewer',
    confidence: null, verified: null, agentName: 'reviewer', model: 'deepseek-reasoner',
    workflowRunId: '12345678-abcd', ...overrides,
  }
}

describe('workflow monitor model', () => {
  test('summarizes every workflow state used by the monitor', () => {
    const summary = summarizeWorkflowRuns([
      run({ runId: 'running', status: 'running' }),
      run({ runId: 'paused', status: 'paused' }),
      run({ runId: 'done', status: 'completed' }),
      run({ runId: 'stopped', status: 'cancelled' }),
      run({ runId: 'failed', status: 'failed' }),
    ])

    expect(summary).toEqual({ running: 1, paused: 1, completed: 1, stopped: 1, failed: 1 })
  })

  test('lists only non-empty status buckets in the subtitle', () => {
    expect(workflowSummaryLine([
      run({ runId: 'a', status: 'running' }),
      run({ runId: 'b', status: 'running' }),
      run({ runId: 'c', status: 'completed' }),
    ])).toBe('2 running · 1 completed')
    expect(workflowSummaryLine([run({ status: 'completed' })])).toBe('1 completed')
  })

  test('freezes duration at completedAt for terminal workflows', () => {
    const finished = run({ status: 'completed', completedAt: '2026-01-01T00:00:12.000Z' })

    expect(workflowDurationMs(finished, Date.parse('2026-01-01T01:00:00.000Z'))).toBe(12_000)
  })

  test('renders the run row with the icon, agent count, tokens and duration', () => {
    const now = Date.parse('2026-01-01T00:00:05.000Z')

    expect(formatWorkflowRunRow(run(), 120, now)).toBe('⟳ audit  2 agents · 4k tok · 5s')
    expect(formatWorkflowRunRow(run({ status: 'completed', completedAt: '2026-01-01T00:01:06.000Z' }), 120, now))
      .toBe('✔ audit  2 agents · 4k tok · 1m 6s')
    expect(formatCompactWorkflowRow(run({ status: 'budget_exhausted' }), 80, now)).toContain('budget_exhausted')
  })

  test('appends done to the header only once the run settles', () => {
    const now = Date.parse('2026-01-01T00:00:05.000Z')
    const agents = [agent(), agent({ id: 'agent-2', status: 'running' })]

    expect(formatWorkflowHeaderStats(run(), agents, now)).toBe('1/2 agents · 5s')
    expect(formatWorkflowHeaderStats(run({ status: 'completed', completedAt: '2026-01-01T00:01:23.000Z' }), agents, now))
      .toBe('1/2 agents · 1m23s · done')
  })

  test('marks phases done, active or pending exactly like Claude Code', () => {
    expect(formatWorkflowPhaseRow('Phase 1', 0, 'done', 2, 2, 15)).toBe('✔ Phase 1   2/2')
    expect(formatWorkflowPhaseRow('Phase 1', 0, 'active', 0, 2, 15)).toBe('1 Phase 1   0/2')
    // A phase that has not started yet shows no counter at all.
    expect(formatWorkflowPhaseRow('Phase 2', 1, 'pending', 0, 0, 15)).toBe('2 Phase 2')
  })

  test('right-aligns the agent duration inside the phase panel', () => {
    expect(formatWorkflowPanelAgentRow(agent({ task: 'p1-red', status: 'running' }), 60))
      .toBe('● p1-red  deepseek-reasoner · 1.2k tok                    3s')
    expect(formatWorkflowPanelAgentRow(agent({ task: 'p1-red' }), 60)).toStartWith('✔ p1-red')
  })

  test('groups agents by the phase captured at spawn time', () => {
    const phases = ['Alpha', 'Beta']
    const agents = [
      agent({ id: 'a', task: 'alpha-red', workflowPhase: 'Alpha' }),
      agent({ id: 'b', task: 'beta-blue', workflowPhase: 'Beta', status: 'running' }),
    ]

    expect(agentsInPhase(agents, 'Alpha', phases).map(item => item.id)).toEqual(['a'])
    expect(phaseStateOf('Alpha', run(), agentsInPhase(agents, 'Alpha', phases))).toBe('done')
    expect(phaseStateOf('Beta', run(), agentsInPhase(agents, 'Beta', phases))).toBe('active')
  })

  test('falls back to every agent when the runtime never reported phases', () => {
    const agents = [agent({ id: 'a' }), agent({ id: 'b' })]

    expect(agentsInPhase(agents, 'Phase 1', ['Phase 1'])).toHaveLength(2)
  })

  test('keeps the selected run visible and offers stop only while active', () => {
    const runs = Array.from({ length: 8 }, (_, index) => run({ runId: `run-${index}` }))

    expect(windowRows(runs, 6, 3)).toEqual({ rows: runs.slice(4, 7), start: 4 })
    expect(workflowListHint('running')).toBe('↑/↓ to select · Enter to view · x to stop · s to save · Esc to close')
    expect(workflowListHint('completed')).toBe('↑/↓ to select · Enter to view · s to save · Esc to close')
  })
})

describe('declared phase skeleton', () => {
  test('shows meta.phases before the runtime announces them', () => {
    const declared = run({
      meta: { name: 'audit', phases: [{ title: 'Scan' }, { title: 'Fix' }] },
      phase: 'Scan', phaseHistory: ['Scan'],
    })

    // Fix has not started, but it must already be listed so the monitor can render it as pending.
    expect(workflowPhases(declared)).toEqual(['Scan', 'Fix'])
    expect(phaseStateOf('Fix', declared, [])).toBe('pending')
    expect(phaseStateOf('Scan', declared, [])).toBe('active')
  })

  test('keeps runtime-only phases when nothing was declared', () => {
    expect(workflowPhases(run({ phaseHistory: ['Alpha'], phase: 'Beta' }))).toEqual(['Alpha', 'Beta'])
  })
})

describe('restored runs without live agents', () => {
  test('uses the recorded history to tell finished phases from unstarted ones', () => {
    const restored = run({
      status: 'running', phase: 'Beta', phaseHistory: ['Alpha', 'Beta'],
      meta: { name: 'audit', phases: [{ title: 'Alpha' }, { title: 'Beta' }, { title: 'Gamma' }] },
    })

    // No agents survive a session restart, so the history is the only evidence Alpha ran.
    expect(phaseStateOf('Alpha', restored, [])).toBe('done')
    expect(phaseStateOf('Beta', restored, [])).toBe('active')
    expect(phaseStateOf('Gamma', restored, [])).toBe('pending')
  })

  test('leaves no phase active once the run has settled', () => {
    const finished = run({ status: 'completed', phase: 'Beta', phaseHistory: ['Alpha', 'Beta'] })

    expect(phaseStateOf('Beta', finished, [])).toBe('done')
    expect(phaseStateOf('Alpha', finished, [])).toBe('done')
  })

  test('keeps the selected phase on screen when the list outgrows the panel', () => {
    const rows = Array.from({ length: 12 }, (_, index) => `phase-${index}`)

    const windowed = windowRows(rows, 11, 4)
    expect(windowed.rows).toEqual(['phase-8', 'phase-9', 'phase-10', 'phase-11'])
    expect(windowed.start + windowed.rows.indexOf('phase-11')).toBe(11)
  })
})
