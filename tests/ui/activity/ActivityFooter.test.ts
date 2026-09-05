import { describe, expect, test } from 'bun:test'
import {
  buildActionHint,
  buildActivityItems,
  compactActivityItems,
  formatActivityItem,
  getActivityWindow,
  groupIdleActivityItems,
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

  test('labels temporary agents with their sequential AgentN name', () => {
    const items = buildActivityItems([agent({ id: 'temp', agentName: 'Agent3' })], [])

    expect(items[0]).toMatchObject({ id: 'temp', label: 'Agent3', fixed: false })
    expect(formatActivityItem(items[0]!, 100)).toContain('Agent3')
  })

  test('keeps queued, running, and paused workflows in the compact footer', () => {
    const items = buildActivityItems([], [
      workflow({ runId: 'running', status: 'running' }),
      workflow({ runId: 'queued', status: 'queued' }),
      workflow({ runId: 'paused', status: 'paused' }),
      workflow({ runId: 'done', status: 'completed' }),
      workflow({ runId: 'stopped', status: 'cancelled' }),
    ])

    expect(items.map(item => item.id)).toEqual(['running', 'queued', 'paused'])
  })

  test('marks a workflow owned by another session read-only and removes control hints', () => {
    const item = buildActivityItems([], [workflow()], 1_000, () => false)[0]!

    expect(item).toMatchObject({ kind: 'workflow', controllable: false })
    expect(buildActionHint(item)).toContain('read-only')
    expect(buildActionHint(item)).not.toContain('x stop')
    expect(formatActivityItem(item, 120, 5_000)).toContain('read-only')
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
    expect(formatActivityItem(item, 100, 11_000, '●')).toMatch(/^● /)
    expect(rich.length).toBeLessThanOrEqual(100)
    expect(narrow.length).toBeLessThanOrEqual(38)
  })

  test('uses a task decoration as the row body while preserving label, icon, and width', () => {
    const item = buildActivityItems([agent({ agentName: 'reviewer' })], [])[0]!
    const row = formatActivityItem(item, 44, 11_000, '●', 'custom status from command')

    expect(row).toMatch(/^● Reviewer/)
    expect(row).toContain('custom status from command')
    expect(row).not.toContain('Inspect the repository')
    expect(row).not.toContain('↓ 2.0k tokens')
    expect(row.length).toBeLessThanOrEqual(44)
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

  test('keeps recently completed workflows out of the active footer', () => {
    const run = workflow({
      status: 'completed',
      completedAt: new Date(95_000).toISOString(),
    })

    expect(buildActivityItems([], [run], 100_000)).toEqual([])
  })

  test('prioritizes active work over completed rows without losing stable start ordering', () => {
    const items = buildActivityItems([
      agent({ id: 'done', status: 'done', startedAt: 1_000 }),
      agent({ id: 'running', status: 'running', startedAt: 2_000 }),
      agent({ id: 'queued', status: 'queued', startedAt: 3_000 }),
    ], [])

    expect(items.map(item => item.id)).toEqual(['running', 'queued', 'done'])
  })

  test('prioritizes a paused workflow with resumable activity before retained completed rows', () => {
    const items = buildActivityItems([
      agent({ id: 'done', status: 'done', startedAt: 1_000 }),
    ], [workflow({ runId: 'paused', status: 'paused', startedAt: new Date(2_000).toISOString() })])

    expect(items.map(item => item.id)).toEqual(['paused', 'done'])
  })

  test('groups four completed agents into one idle summary for compact rendering', () => {
    const items = buildActivityItems([
      agent({ id: 'done-1', status: 'done' }),
      agent({ id: 'done-2', status: 'done' }),
      agent({ id: 'done-3', status: 'done' }),
      agent({ id: 'done-4', status: 'done' }),
      agent({ id: 'failed', status: 'failed' }),
      agent({ id: 'running', status: 'running' }),
    ], [])

    const grouped = groupIdleActivityItems(items)
    expect(grouped).toHaveLength(3)
    expect(grouped[0]).toMatchObject({ kind: 'agent', id: 'running' })
    expect(grouped[1]).toMatchObject({ kind: 'agent', id: 'failed' })
    expect(grouped[2]).toMatchObject({ kind: 'idle-group', label: 'idle agents', active: false })
    expect(formatActivityItem(grouped[2]!, 100)).toContain('4 idle agents')
    expect(buildActionHint(grouped[2])).toBe('↑/↓ to select')
  })

  test('does not group fewer than four completed agents', () => {
    const items = buildActivityItems([
      agent({ id: 'done-1', status: 'done' }),
      agent({ id: 'done-2', status: 'done' }),
      agent({ id: 'done-3', status: 'done' }),
    ], [])

    expect(groupIdleActivityItems(items).map(item => item.id)).toEqual(['done-1', 'done-2', 'done-3'])
  })

  test('keeps the selected row visible and reports overflow on both sides', () => {
    const items: ActivityItem[] = Array.from({ length: 8 }, (_, index) => ({
      kind: 'agent', id: String(index), label: 'Subagent', description: `task ${index}`,
      status: 'running', fixed: false, active: true, startedAt: index,
      agent: agent({ id: String(index), task: `task ${index}` }),
    }))

    expect(getActivityWindow(items, 3, 4)).toEqual({
      rows: items.slice(2, 5), start: 2, above: 2, below: 3,
    })
  })

  test('retains a recently completed agent but drops stale completion from activity rows', () => {
    const items = buildActivityItems([
      agent({ id: 'recent', status: 'done', completedAt: 80_000 }),
      agent({ id: 'stale', status: 'done', completedAt: 10_000 }),
    ], [], 100_000)

    expect(items.map(item => item.id)).toEqual(['recent'])
  })

  test('indents a child only when its parent is visible in the activity set', () => {
    const parent = agent({ id: 'parent', agentName: 'Coordinator', startedAt: 1_000 })
    const child = agent({ id: 'child', agentName: 'Coder', parentTaskId: 'parent', type: 'review', startedAt: 2_000 })
    const items = buildActivityItems([parent, child], [])
    const childItem = items.find(item => item.id === 'child')!

    expect(childItem).toMatchObject({ kind: 'agent', indent: 1 })
    expect(formatActivityItem(childItem, 100)).toContain('↳ Coder')
  })

  test('does not indent a child whose parent is outside the visible activity set', () => {
    const child = agent({ id: 'child', agentName: 'Coder', parentTaskId: 'main-task', startedAt: 2_000 })
    const childItem = buildActivityItems([child], [])[0]!

    expect(childItem).toMatchObject({ kind: 'agent', indent: 0 })
    expect(formatActivityItem(childItem, 100)).not.toContain('↳')
  })
})

describe('claude code footer visual contract', () => {
  test('finished agents render idle instead of a status icon', () => {
    const item = buildActivityItems([agent({ status: 'done', durationMs: 25_000, tokens: 3_000 })], [])[0]!
    const row = formatActivityItem(item, 100, 11_000)

    expect(row).toContain('idle')
    expect(row).not.toContain('✓')
    expect(row).not.toContain('25s')
    expect(row).toMatch(/^◯ /)
  })

  test('active agents render duration and ↓ tokens', () => {
    const item = buildActivityItems([agent({ status: 'running', durationMs: null, tokens: 63_000 })], [])[0]!
    const row = formatActivityItem(item, 100, 29_000)

    expect(row).toContain('28s')
    expect(row).toContain('↓ 63.0k tokens')
    expect(row).not.toContain('tools')
  })

  test('non-selected rows always use the ◯ icon regardless of status', () => {
    const rows = ['done', 'failed', 'timed_out', 'running'].map(status =>
      formatActivityItem(buildActivityItems([agent({ status } as Partial<SubagentState>)], [])[0]!, 100))

    for (const row of rows) expect(row).toMatch(/^◯ /)
  })

  test('selected rows use the ● icon override', () => {
    const item = buildActivityItems([agent({ status: 'running' })], [])[0]!

    expect(formatActivityItem(item, 100, 11_000, '●')).toMatch(/^● /)
  })

  test('buildActionHint uses claude code phrasing with contextual actions', () => {
    expect(buildActionHint(undefined)).toBe('↑/↓ to select')
    expect(buildActionHint(buildActivityItems([agent({ status: 'running' })], [])[0]))
      .toBe('↑/↓ to select · Enter to view · x stop')
    expect(buildActionHint(buildActivityItems([agent({ status: 'failed' })], [])[0]))
      .toBe('↑/↓ to select · Enter to view · r resume')
    expect(buildActionHint(buildActivityItems([agent({ status: 'blocked' })], [])[0]))
      .toBe('↑/↓ to select · Enter to view · x stop · r resume')
    expect(buildActionHint(buildActivityItems([], [workflow()])[0]))
      .toBe('↑/↓ to select · Enter to view · x stop · p pause')
    expect(buildActionHint(buildActivityItems([], [workflow({ status: 'queued' })])[0]))
      .toBe('↑/↓ to select · Enter to view · x stop')
    expect(buildActionHint(buildActivityItems([], [workflow({ status: 'paused' })])[0]))
      .toBe('↑/↓ to select · Enter to view · x stop · r resume')
  })
})
