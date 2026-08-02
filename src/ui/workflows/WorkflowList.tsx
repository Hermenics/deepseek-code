import { useEffect, useState } from 'react'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import type { WorkflowManager } from '../../workflows/manager.js'
import type { WorkflowRun } from '../../workflows/types.js'

const ACTIVE = new Set(['queued', 'running', 'paused'])

export function formatWorkflowRun(run: WorkflowRun, now = Date.now()): string {
  const started = Date.parse(run.startedAt ?? run.createdAt)
  const duration = Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : 0
  const phase = run.phase ? ` · ${run.phase}` : ''
  const tokens = run.options.maxTokens ? `${run.usage.tokens}/${run.options.maxTokens} tokens` : `${run.usage.tokens} tokens`
  const cost = run.options.maxCostUsd !== undefined ? ` · $${run.usage.costUsd.toFixed(4)}/$${run.options.maxCostUsd.toFixed(4)}` : ''
  const worktrees = run.worktrees.length ? ` · ${run.worktrees.length} worktree${run.worktrees.length === 1 ? '' : 's'}` : ''
  return `  ${run.runId.slice(0, 8)}  ${run.meta.name} · ${run.status}${phase} · ${duration}s · ${run.usage.agents} agents · ${tokens}${cost}${worktrees}`
}

export function WorkflowList({ manager }: { manager: WorkflowManager }) {
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [, setClock] = useState(0)

  useEffect(() => {
    void manager.list().then(setRuns)
    return manager.subscribe(event => {
      setRuns(current => {
        const next = current.filter(run => run.runId !== event.run.runId)
        return [event.run, ...next]
      })
    })
  }, [manager])

  useEffect(() => {
    if (!runs.some(run => ACTIVE.has(run.status))) return
    const timer = setInterval(() => setClock(value => value + 1), 1_000)
    return () => clearInterval(timer)
  }, [runs])

  const active = runs.filter(run => ACTIVE.has(run.status))
  if (!active.length) return null

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="magenta">{'◆ Dynamic Workflows'}</Text>
      {active.map(run => (
        <Text key={run.runId} color={run.status === 'paused' ? 'yellow' : 'cyan'}>{formatWorkflowRun(run)}</Text>
      ))}
    </Box>
  )
}
