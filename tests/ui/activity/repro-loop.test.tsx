// TEMP REPRO — simulates production: host toggling open + live clock + items completing
import { expect, test } from 'bun:test'
import React, { useState } from 'react'
import { PassThrough } from 'node:stream'
import { renderSync } from '../../../src/ink/root.js'
import { ActivityFooter } from '../../../src/ui/activity/ActivityFooter.js'
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
    id: 'agent-1', task: 'audit security', agentName: 'Agent1', role: 'coder', mode: 'build',
    status: 'running', startedAt: Date.now(), toolCount: 3, tokens: 1200,
    ...overrides,
  } as SubagentState
}

function Host({ onChangeOpen, onChangeAgents }: {
  onChangeOpen: (set: (v: boolean) => void) => void
  onChangeAgents: (set: (v: SubagentState[]) => void) => void
}) {
  const [open, setOpen] = useState(false)
  const [agents, setAgents] = useState<SubagentState[]>([])
  onChangeOpen(setOpen)
  onChangeAgents(setAgents)
  return (
    <ActivityFooter
      agents={agents}
      workflows={[]}
      open={open}
      onClose={() => setOpen(false)}
      onOpenWorkflow={() => {}}
      onTaskAction={async () => ''}
      onWorkflowAction={async () => ''}
    />
  )
}

test('repro: open with items, items complete while open, close', async () => {
  const stdin = new FakeTerminal()
  const stdout = new FakeTerminal()
  let setOpen: ((v: boolean) => void) | null = null
  let setAgents: ((v: SubagentState[]) => void) | null = null

  const instance = renderSync(
    <Host
      onChangeOpen={set => { setOpen = set }}
      onChangeAgents={set => { setAgents = set }}
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
    // agent spawns (like a subagent starting)
    setAgents!([fakeAgent()])
    await Bun.sleep(200) // let clock tick re-renders happen
    // user opens footer
    setOpen!(true)
    await Bun.sleep(300)
    // agent completes while footer open
    setAgents!([])
    await Bun.sleep(300)
    // user closes / reopens cycles
    setOpen!(false)
    await Bun.sleep(200)
    setOpen!(true)
    await Bun.sleep(200)
    setAgents!([fakeAgent({ status: 'done', durationMs: 5000 })])
    await Bun.sleep(300)
    expect(true).toBe(true)
  } finally {
    stdout.isTTY = false
    instance.unmount()
    instance.cleanup()
  }
})
