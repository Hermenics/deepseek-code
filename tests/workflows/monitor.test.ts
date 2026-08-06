import { expect, test } from 'bun:test'
import { formatWorkflowRun } from '../../src/ui/workflows/WorkflowList.js'
import type { WorkflowRun } from '../../src/workflows/types.js'

test('workflow monitor renders phase, duration, budgets, agents and worktrees', () => {
  const run: WorkflowRun = {
    runId: '12345678-abcd', sessionId: 'session', projectRoot: '/project', meta: { name: 'audit' }, status: 'running',
    phase: 'review', scriptHash: 'script', argsHash: 'args', optionsHash: 'options', options: { maxTokens: 100, maxCostUsd: 1 },
    createdAt: '2026-01-01T00:00:00.000Z', startedAt: '2026-01-01T00:00:00.000Z',
    usage: { agents: 2, tokens: 40, costUsd: 0.25 }, failures: [], worktrees: [{ taskId: 'writer', path: '/tmp/writer' }],
  }
  expect(formatWorkflowRun(run, Date.parse('2026-01-01T00:00:05.000Z'))).toBe(
    '  12345678  audit · running · review · 5s · 2 agents · ↓ 40/100 tokens · $0.2500/$1.0000 · 1 worktree',
  )
})
