import { expect, test } from 'bun:test'
import React from 'react'
import { PassThrough } from 'node:stream'
import { renderSync } from '../../src/ink/root.js'
import { WorkflowMonitor } from '../../src/ui/workflows/WorkflowMonitor.js'
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

test('p resumes a paused workflow from the monitor', async () => {
  const stdin = new FakeTerminal()
  const stdout = new FakeTerminal()
  const resumed: string[] = []
  const run: WorkflowRun = {
    runId: 'paused-run', sessionId: 'session', projectRoot: '/project', meta: { name: 'audit' },
    status: 'paused', scriptHash: 'script', argsHash: 'args', optionsHash: 'options', options: {},
    createdAt: new Date().toISOString(), startedAt: new Date().toISOString(),
    usage: { agents: 1, tokens: 10, costUsd: 0 }, failures: [], worktrees: [],
  }
  const instance = renderSync(
    <WorkflowMonitor
      runs={[run]}
      initialRunId={run.runId}
      onClose={() => {}}
      onPause={async () => false}
      onResume={async id => { resumed.push(id); return true }}
      onStop={async () => false}
      onRestart={async () => {}}
      onSave={async () => ''}
    />,
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  )

  try {
    await Bun.sleep(100)
    stdin.write('p')
    await Bun.sleep(100)
    expect(resumed).toEqual(['paused-run'])
  } finally {
    stdout.isTTY = false
    instance.unmount()
    instance.cleanup()
  }
})
