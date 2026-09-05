import { afterEach, expect, test } from 'bun:test'
import React, { useEffect } from 'react'
import { PassThrough } from 'node:stream'
import { renderSync } from '../../src/ink/root.js'
import { useActiveWorkflowRuns, useWorkflowRuns } from '../../src/ui/workflows/WorkflowList.js'
import type { WorkflowManager } from '../../src/workflows/manager.js'
import type { WorkflowRun } from '../../src/workflows/types.js'

class FakeTerminal extends PassThrough {
  isTTY = true
  isRaw = false
  columns = 100
  rows = 24
  setRawMode(enabled: boolean): this { this.isRaw = enabled; return this }
  ref(): this { return this }
  unref(): this { return this }
}

const terminals: FakeTerminal[] = []
afterEach(() => {
  for (const terminal of terminals.splice(0)) terminal.isTTY = false
})

function workflow(runId: string): WorkflowRun {
  const now = new Date().toISOString()
  return {
    runId, sessionId: 'session', projectRoot: '/project', meta: { name: runId }, status: 'running',
    scriptHash: 'script', argsHash: 'args', optionsHash: 'options', options: {}, createdAt: now, startedAt: now,
    usage: { agents: 0, tokens: 0, costUsd: 0 }, failures: [], worktrees: [],
  }
}

function Probe({ manager, onRuns }: { manager: WorkflowManager; onRuns(runs: WorkflowRun[]): void }) {
  const runs = useActiveWorkflowRuns(manager)
  useEffect(() => { onRuns(runs) }, [onRuns, runs])
  return null
}

function HistoryProbe({ manager, onRuns }: { manager: WorkflowManager; onRuns(runs: WorkflowRun[]): void }) {
  const runs = useWorkflowRuns(manager)
  useEffect(() => { onRuns(runs) }, [onRuns, runs])
  return null
}

test('active workflow hook refreshes external sessions and removes stale rows', async () => {
  const stdin = new FakeTerminal()
  const stdout = new FakeTerminal()
  terminals.push(stdin, stdout)
  let current = [workflow('first')]
  const manager = {
    listActiveRuns: async () => current,
    subscribe: () => () => {},
  } as unknown as WorkflowManager
  const snapshots: string[][] = []
  const instance = renderSync(<Probe manager={manager} onRuns={runs => snapshots.push(runs.map(run => run.runId))} />, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    exitOnCtrlC: false,
    patchConsole: false,
  })

  try {
    await Bun.sleep(100)
    current = [workflow('second')]
    await Bun.sleep(1_200)
    expect(snapshots.at(-1)).toEqual(['second'])
  } finally {
    instance.unmount()
    instance.cleanup()
  }
})

test('history workflow hook refreshes external sessions for the monitor', async () => {
  const stdin = new FakeTerminal()
  const stdout = new FakeTerminal()
  terminals.push(stdin, stdout)
  let current = [workflow('first')]
  const manager = {
    list: async () => current,
    subscribe: () => () => {},
  } as unknown as WorkflowManager
  const snapshots: string[][] = []
  const instance = renderSync(<HistoryProbe manager={manager} onRuns={runs => snapshots.push(runs.map(run => run.runId))} />, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    exitOnCtrlC: false,
    patchConsole: false,
  })

  try {
    await Bun.sleep(100)
    current = [workflow('second')]
    await Bun.sleep(1_200)
    expect(snapshots.at(-1)).toEqual(['second'])
  } finally {
    instance.unmount()
    instance.cleanup()
  }
})
