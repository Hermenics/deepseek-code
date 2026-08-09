import { describe, expect, test } from 'bun:test'
import {
  formatCompactWorkflowRow,
  formatWorkflowAgentRow,
  formatWorkflowPanelAgentRow,
  formatWorkflowPhaseRow,
  formatWorkflowListRow,
  groupWorkflowRuns,
  summarizeWorkflowRuns,
  windowWorkflowRuns,
  workflowControlHint,
  workflowDurationMs,
} from '../../src/ui/workflows/WorkflowMonitor.js'
import type { WorkflowRun } from '../../src/workflows/types.js'

function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    runId: '12345678-abcd', sessionId: 'session', projectRoot: '/project',
    meta: { name: 'audit' }, status: 'running', scriptHash: 'script', argsHash: 'args',
    optionsHash: 'options', options: {}, createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z', usage: { agents: 2, tokens: 4000, costUsd: 0 },
    failures: [], worktrees: [], ...overrides,
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

  test('freezes duration at completedAt for terminal workflows', () => {
    const finished = run({
      status: 'completed',
      completedAt: '2026-01-01T00:00:12.000Z',
    })

    expect(workflowDurationMs(finished, Date.parse('2026-01-01T01:00:00.000Z'))).toBe(12_000)
  })

  test('uses the same cursor markers and dense row style as the activity footer', () => {
    expect(formatWorkflowListRow(run(), 120)).toStartWith('◯ workflow audit')
    expect(formatWorkflowListRow(run(), 120, Date.now(), [], true)).toStartWith('● workflow audit')
  })

  test('groups every status into Working, Needs input, or Completed', () => {
    const groups = groupWorkflowRuns([
      run({ runId: 'queued', status: 'queued' }),
      run({ runId: 'running', status: 'running' }),
      run({ runId: 'paused', status: 'paused' }),
      run({ runId: 'completed', status: 'completed' }),
      run({ runId: 'failed', status: 'failed' }),
      run({ runId: 'cancelled', status: 'cancelled' }),
      run({ runId: 'timed-out', status: 'timed_out' }),
      run({ runId: 'budget', status: 'budget_exhausted' }),
    ])

    expect(groups.map(group => [group.name, group.runs.map(run => run.status)])).toEqual([
      ['Working', ['queued', 'running']],
      ['Needs input', ['paused']],
      ['Completed', ['completed', 'failed', 'cancelled', 'timed_out', 'budget_exhausted']],
    ])
  })

  test('keeps duration right-aligned and terminal status explicit in compact mode', () => {
    const now = Date.parse('2026-01-01T00:00:05.000Z')
    expect(formatWorkflowListRow(run({ phase: 'reviewing' }), 90, now)).toContain('reviewing')
    expect(formatCompactWorkflowRow(run({ status: 'budget_exhausted' }), 80, now)).toContain('budget_exhausted')
  })

  test('renders workflow agents from the orchestration state', () => {
    const agentRun = {
      id: 'agent-1', task: 'Review it', status: 'done' as const, colorIndex: 0, toolCount: 1,
      lastToolInfo: null, startedAt: Date.parse('2026-01-01T00:00:00.000Z'), durationMs: 3_000,
      result: 'done', error: null, tokens: 1200, costUsd: 0.01, role: 'reviewer' as const,
      confidence: null, verified: null, agentName: 'reviewer', model: 'deepseek-reasoner', workflowRunId: '12345678-abcd',
    }

    expect(formatWorkflowListRow(run(), 120, Date.now(), [agentRun])).toContain('1/2 agents done')
    expect(formatWorkflowListRow(run(), 120)).toContain('4.0k tok')
    expect(formatWorkflowAgentRow(agentRun, 120)).toBe('✓ Reviewer · Review it · 3s · ↓ 1.2k tokens · deepseek-reasoner')
    expect(formatWorkflowPanelAgentRow({ ...agentRun, task: 'review:security', status: 'running' }, 120)).toBe('● review:security  deepseek-reasoner · 1.2k tok · 3s')
    expect(formatWorkflowPhaseRow('Review', 0, true, 0, 2, 30)).toBe('> 1 Review 0/2')
  })

  test('keeps the selected run visible and exposes state-specific controls', () => {
    const runs = Array.from({ length: 8 }, (_, index) => run({ runId: `run-${index}` }))

    expect(windowWorkflowRuns(runs, 6, 3)).toEqual({ runs: runs.slice(4, 7), start: 4 })
    expect(workflowControlHint('running')).toContain('p pause')
    expect(workflowControlHint('paused')).toContain('p resume')
    expect(workflowControlHint('completed')).toContain('r restart')
  })
})
