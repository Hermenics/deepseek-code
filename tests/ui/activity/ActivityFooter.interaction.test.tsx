import { expect, test } from 'bun:test'
import React from 'react'
import { PassThrough } from 'node:stream'
import { renderSync } from '../../../src/ink/root.js'
import { ActivityFooter } from '../../../src/ui/activity/ActivityFooter.js'
import type { WorkflowRun } from '../../../src/workflows/types.js'

class FakeTerminal extends PassThrough {
  isTTY = true
  isRaw = false
  columns = 100
  rows = 24
  setRawMode(enabled: boolean): this { this.isRaw = enabled; return this }
  ref(): this { return this }
  unref(): this { return this }
}

test('controls and opens the selected workflow', async () => {
  const stdin = new FakeTerminal()
  const stdout = new FakeTerminal()
  const actions: string[] = []
  const opened: string[] = []
  const run: WorkflowRun = {
    runId: 'workflow-1', sessionId: 'session', projectRoot: '/project', meta: { name: 'audit' },
    status: 'running', scriptHash: 'script', argsHash: 'args', optionsHash: 'options', options: {},
    createdAt: new Date().toISOString(), startedAt: new Date().toISOString(),
    usage: { agents: 0, tokens: 0, costUsd: 0 }, failures: [], worktrees: [],
  }
  const instance = renderSync(
    <ActivityFooter
      agents={[]}
      workflows={[run]}
      open
      onClose={() => {}}
      onOpenWorkflow={id => opened.push(id)}
      onTaskAction={async () => ''}
      onWorkflowAction={async (_id, action) => { actions.push(action); return '' }}
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
    stdin.write('\r')
    await Bun.sleep(100)
    expect(actions).toEqual(['pause'])
    expect(opened).toEqual(['workflow-1'])
  } finally {
    stdout.isTTY = false
    instance.unmount()
    instance.cleanup()
  }
})
