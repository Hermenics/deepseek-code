import { useEffect, useState } from 'react'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import type { WorkflowManager } from '../../workflows/manager.js'
import type { WorkflowRun } from '../../workflows/types.js'
import { isWorkflowRunActive } from '../../workflows/storage.js'

const WORKFLOW_POLL_MS = 1_000

export interface WorkflowRunListOptions {
  /** Use the lease-aware activity view instead of the complete historical list. */
  activeOnly?: boolean
}

export function useWorkflowRuns(manager: WorkflowManager, options: WorkflowRunListOptions = {}): WorkflowRun[] {
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const activeOnly = options.activeOnly ?? false

  useEffect(() => {
    let mounted = true
    let request = 0
    const refresh = (replace = false) => {
      const sequence = ++request
      const loaded = activeOnly ? manager.listActiveRuns() : manager.list()
      void loaded.then(next => {
        if (!mounted || sequence !== request) return
        if (replace) {
          setRuns(next)
          return
        }
        setRuns(current => current.length ? [...current, ...next.filter(run => !current.some(latest => latest.runId === run.runId))] : next)
      }).catch(() => undefined)
    }
    // The default hook is consumed by the monitor, which must retain interrupted/active
    // historical records for restart and replay. The footer opts into the lease-aware view.
    refresh()
    // Poll the history view too: a workflow started or completed in another TUI
    // process cannot emit through this manager's in-memory subscription.
    const pollTimer = setInterval(() => refresh(true), WORKFLOW_POLL_MS)
    const unsubscribe = manager.subscribe(event => {
      request++
      setRuns(current => {
        if (activeOnly && !isWorkflowRunActive(event.run)) return current.filter(run => run.runId !== event.run.runId)
        const next = current.filter(run => run.runId !== event.run.runId)
        return [event.run, ...next]
      })
    })
    return () => { mounted = false; if (pollTimer) clearInterval(pollTimer); unsubscribe() }
  }, [activeOnly, manager])

  return runs
}

/** Lease-aware activity list for footers; history consumers should keep useWorkflowRuns(). */
export function useActiveWorkflowRuns(manager: WorkflowManager): WorkflowRun[] {
  return useWorkflowRuns(manager, { activeOnly: true })
}

export function formatWorkflowRun(run: WorkflowRun, now = Date.now()): string {
  const started = Date.parse(run.startedAt ?? run.createdAt)
  const ended = run.completedAt ? Date.parse(run.completedAt) : now
  const duration = Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, Math.floor((ended - started) / 1000)) : 0
  const phase = run.phase ? ` · ${run.phase}` : ''
  const tokens = `↓ ${run.options.maxTokens ? `${run.usage.tokens}/${run.options.maxTokens}` : run.usage.tokens} tokens`
  const cost = run.options.maxCostUsd !== undefined ? ` · $${run.usage.costUsd.toFixed(4)}/$${run.options.maxCostUsd.toFixed(4)}` : ''
  const worktrees = run.worktrees.length ? ` · ${run.worktrees.length} worktree${run.worktrees.length === 1 ? '' : 's'}` : ''
  return `  ${run.runId.slice(0, 8)}  ${run.meta.name} · ${run.status}${phase} · ${duration}s · ${run.usage.agents} agents · ${tokens}${cost}${worktrees}`
}

export function WorkflowList({ manager }: { manager: WorkflowManager }) {
  const runs = useActiveWorkflowRuns(manager)
  const [, setClock] = useState(0)

  useEffect(() => {
    if (!runs.some(isWorkflowRunActive)) return
    const timer = setInterval(() => setClock(value => value + 1), 1_000)
    return () => clearInterval(timer)
  }, [runs])

  const active = runs.filter(isWorkflowRunActive)
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
