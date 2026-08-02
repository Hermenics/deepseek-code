import { describe, expect, test } from 'bun:test'
import {
  buildActivityItems,
  compactActivityItems,
  formatActivityItem,
  type ActivityItem,
} from '../../../src/ui/activity/ActivityFooter.js'
import type { SubagentState } from '../../../src/ui/subagent/types.js'
import type { WorkflowRun } from '../../../src/workflows/types.js'

function agent(overrides: Partial<SubagentState> = {}): SubagentState {
  return {
    id: 'agent-1', task: 'Inspect the repository', status: 'running', colorIndex: 0,
    toolCount: 2, lastToolInfo: 'grep', startedAt: 1_000, durationMs: null,
    result: null, error: null, tokens: 2_000, costUsd: null, role: 'reader',
    confidence: null, verified: null, agentName: null, mode: 'background',
    ...overrides,
  }
}

function workflow(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    runId: 'workflow-1234', sessionId: 'session', projectRoot: '/project',
    meta: { name: 'repository-audit', description: 'Audit the repository' }, status: 'running',
    phase: 'review', scriptHash: 'script', argsHash: 'args', optionsHash: 'options', options: {},
    createdAt: new Date(1_000).toISOString(), startedAt: new Date(1_000).toISOString(),
    usage: { agents: 2, tokens: 4_000, costUsd: 0 }, failures: [], worktrees: [],
    ...overrides,
  }
}

describe('activity footer model', () => {
  test('distinguishes fixed and temporary agents', () => {
    const items = buildActivityItems([
      agent({ id: 'fixed', agentName: 'coder' }),
      agent({ id: 'temporary', agentName: null }),
    ], [])

    expect(items.map(item => [item.id, item.label, item.fixed])).toEqual([
      ['fixed', 'Coder', true],
      ['temporary', 'Subagent', false],
    ])
  })

  test('includes only queued and running workflows in the compact footer', () => {
    const items = buildActivityItems([], [
      workflow({ runId: 'running', status: 'running' }),
      workflow({ runId: 'queued', status: 'queued' }),
      workflow({ runId: 'paused', status: 'paused' }),
      workflow({ runId: 'done', status: 'completed' }),
      workflow({ runId: 'stopped', status: 'cancelled' }),
    ])

    expect(items.map(item => item.id)).toEqual(['running', 'queued'])
  })

  test('caps compact rows and reports overflow', () => {
    const items: ActivityItem[] = Array.from({ length: 7 }, (_, index) => ({
      kind: 'agent', id: String(index), label: 'Subagent', description: `task ${index}`,
      status: 'running', fixed: false, active: true, startedAt: 0,
      agent: agent({ id: String(index), task: `task ${index}` }),
    }))

    expect(compactActivityItems(items, 5)).toEqual({ rows: items.slice(0, 5), overflow: 2 })
  })

  test('formats rich and narrow rows without exceeding the requested width', () => {
    const item = buildActivityItems([agent({ agentName: 'reviewer' })], [])[0]!
    const rich = formatActivityItem(item, 100, 11_000)
    const narrow = formatActivityItem(item, 38, 11_000)

    expect(rich).toContain('Reviewer')
    expect(rich).toContain('Inspect the repository')
    expect(rich).toContain('10s')
    expect(rich.length).toBeLessThanOrEqual(100)
    expect(narrow.length).toBeLessThanOrEqual(38)
  })

  test('shows completed agent progress for a running workflow', () => {
    const run = workflow()
    const workflowAgents = [
      agent({ id: 'reader', status: 'done', workflowRunId: run.runId }),
      agent({ id: 'writer', status: 'running', workflowRunId: run.runId }),
    ]

    expect(formatActivityItem(buildActivityItems(workflowAgents, [run])[0]!, 120, 5_000)).toContain('1/2 agents done')
  })

  test('keeps completed workflow agents in the monitor without leaking them into the footer', () => {
    const run = workflow({ status: 'completed' })
    const child = agent({ status: 'done', workflowRunId: run.runId })

    expect(buildActivityItems([child], [run])).toEqual([])
  })
})
