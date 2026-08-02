import { expect, test } from 'bun:test'
import React from 'react'
import { PassThrough } from 'node:stream'
import { renderSync } from '../../../src/ink/root.js'
import { ActivityFooter } from '../../../src/ui/activity/ActivityFooter.js'
import type { WorkflowRun } from '../../../src/workflows/types.js'
import type { SubagentState } from '../../../src/ui/subagent/types.js'

class FakeTerminal extends PassThrough {
  isTTY = true
  isRaw = false
  columns = 100
  rows = 24
  setRawMode(enabled: boolean): this { this.isRaw = enabled; return this }
  ref(): this { return this }
  unref(): this { return this }
}

function fakeAgent(overrides: Partial<SubagentState> = {}): SubagentState {
  return {
    id: 'agent-1', task: 'audit security', agentName: 'Coder', role: 'coder', mode: 'build',
    status: 'running', startedAt: Date.now(), toolCount: 3, tokens: 1200,
    ...overrides,
  } as SubagentState
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

test('agent detail mode: x cancels running agent and r resumes resumable agent', async () => {
  const stdin = new FakeTerminal()
  const stdout = new FakeTerminal()
  const agentActions: string[] = []
  const agent = fakeAgent({ status: 'running' })

  const instance = renderSync(
    <ActivityFooter
      agents={[agent]}
      workflows={[]}
      open
      onClose={() => {}}
      onOpenWorkflow={() => {}}
      onTaskAction={async (_id, action) => { agentActions.push(action); return '' }}
      onWorkflowAction={async () => ''}
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
    // Enter detail mode for the agent
    stdin.write('\r')
    await Bun.sleep(100)
    // x should cancel even in detail mode
    stdin.write('x')
    await Bun.sleep(100)
    expect(agentActions).toEqual(['cancel'])
  } finally {
    stdout.isTTY = false
    instance.unmount()
    instance.cleanup()
  }
})

test('agent detail mode: r triggers resume for a failed agent', async () => {
  const stdin = new FakeTerminal()
  const stdout = new FakeTerminal()
  const agentActions: string[] = []
  const agent = fakeAgent({ status: 'failed' })

  const instance = renderSync(
    <ActivityFooter
      agents={[agent]}
      workflows={[]}
      open
      onClose={() => {}}
      onOpenWorkflow={() => {}}
      onTaskAction={async (_id, action) => { agentActions.push(action); return '' }}
      onWorkflowAction={async () => ''}
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
    // Enter detail mode
    stdin.write('\r')
    await Bun.sleep(100)
    // r should resume in detail mode
    stdin.write('r')
    await Bun.sleep(100)
    expect(agentActions).toEqual(['resume'])
  } finally {
    stdout.isTTY = false
    instance.unmount()
    instance.cleanup()
  }
})
