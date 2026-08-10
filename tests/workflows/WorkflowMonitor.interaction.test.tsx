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

function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    runId: 'workflow-run', sessionId: 'session', projectRoot: '/project', meta: { name: 'audit' },
    status: 'running', scriptHash: 'script', argsHash: 'args', optionsHash: 'options', options: {},
    createdAt: new Date().toISOString(), startedAt: new Date().toISOString(),
    usage: { agents: 1, tokens: 10, costUsd: 0 }, failures: [], worktrees: [], ...overrides,
  }
}

function renderMonitor(runs: WorkflowRun[], props: Partial<React.ComponentProps<typeof WorkflowMonitor>> = {}) {
  const stdin = new FakeTerminal()
  const stdout = new FakeTerminal()
  const instance = renderSync(
    <WorkflowMonitor
      runs={runs}
      onClose={() => {}}
      onPause={async () => false}
      onResume={async () => false}
      onStop={async () => false}
      onRestart={async () => {}}
      onSave={async () => ''}
      {...props}
    />,
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  )
  return { stdin, stdout, instance }
}

async function press(stdin: FakeTerminal, input: string) {
  stdin.write(input)
  await Bun.sleep(50)
}

function cleanup({ stdout, instance }: ReturnType<typeof renderMonitor>) {
  stdout.isTTY = false
  instance.unmount()
  instance.cleanup()
}

test('initialRunId opens that run detail directly and does not fight navigation', async () => {
  const runs = [
    run({ runId: 'running-run' }),
    run({ runId: 'paused-run', status: 'paused', phase: 'Review', phaseHistory: ['Review'] }),
  ]
  const monitor = renderMonitor(runs, { initialRunId: 'paused-run' })
  let rendered = ''
  monitor.stdout.on('data', chunk => { rendered += chunk.toString() })

  try {
    await Bun.sleep(100)
    const opened = rendered.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\s/g, '')
    // Opening a named run skips the picker entirely: no list chrome, straight to the phases panel.
    expect(opened).toContain('Phases')
    expect(opened).not.toContain('Dynamicworkflows')

    await press(monitor.stdin, '\x1b')
    rendered = ''
    // A manager event replaces the runs array; the effect must not drag us back to the detail.
    monitor.instance.rerender(
      <WorkflowMonitor
        runs={[...runs.map(item => ({ ...item, usage: { ...item.usage, tokens: item.usage.tokens + 10 } }))]}
        initialRunId="paused-run"
        onClose={() => {}}
        onPause={async () => false}
        onResume={async () => false}
        onStop={async () => false}
        onRestart={async () => {}}
        onSave={async () => ''}
      />,
    )
    await Bun.sleep(80)
    const afterUpdate = rendered.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\s/g, '')
    expect(afterUpdate).toContain('Dynamicworkflows')
  } finally {
    cleanup(monitor)
  }
})

test('lists runs with the Claude-style header, icons and hint', async () => {
  let saves = 0
  const monitor = renderMonitor([run({ status: 'completed' })], { onSave: async () => { saves++; return '' } })
  let rendered = ''
  monitor.stdout.on('data', chunk => { rendered += chunk.toString() })

  try {
    await Bun.sleep(100)
    const plain = rendered.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\s/g, '')
    expect(plain).toContain('Dynamicworkflows')
    expect(plain).toContain('1completed')
    expect(plain).toContain('✔audit')
    expect(plain).toContain('↑/↓toselect·Entertoview·stosave·Esctoclose')
    expect(saves).toBe(0)
  } finally {
    cleanup(monitor)
  }
})

test('renders the Claude-style phases and agents detail panel', async () => {
  const monitor = renderMonitor([run({
    // Verify is declared but never reached: it comes from meta.phases, not the history.
    meta: { name: 'audit', phases: [{ title: 'Review' }, { title: 'Verify' }] },
    phase: 'Review', phaseHistory: ['Review'], usage: { agents: 2, tokens: 1200, costUsd: 0.01 },
  })], {
    agents: [
      { id: 'security', task: 'review:security', status: 'running' as const, colorIndex: 0, toolCount: 0, lastToolInfo: null, startedAt: Date.now(), durationMs: null, result: null, error: null, tokens: 1200, costUsd: 0, role: null, confidence: null, verified: null, agentName: 'Agent 1', model: 'deepseek-v4-flash', workflowRunId: 'workflow-run' },
      { id: 'tests', task: 'review:tests', status: 'queued' as const, colorIndex: 1, toolCount: 0, lastToolInfo: null, startedAt: Date.now(), durationMs: null, result: null, error: null, tokens: null, costUsd: null, role: null, confidence: null, verified: null, agentName: 'Agent 2', model: 'deepseek-v4-flash', workflowRunId: 'workflow-run' },
    ],
  })
  let rendered = ''
  monitor.stdout.on('data', chunk => { rendered += chunk.toString() })

  try {
    await Bun.sleep(100)
    rendered = ''
    await press(monitor.stdin, '\r')
    const plain = rendered.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\s/g, '')
    expect(plain).toContain('Phases')
    // Active phase keeps its ordinal as the icon and a counter; the untouched one gets neither.
    expect(plain).toContain('❯1Revi')
    expect(plain).toContain('0/2')
    expect(plain).toContain('2Verify')
    expect(plain).toContain('Review·2agents')
    // Agents of the selected phase carry their model and token spend.
    expect(plain).toContain('●review:secur')
    expect(plain).toContain('deepseek-v4-flash·1.2k')
    expect(plain).toContain('↑↓select·escback·ssave')
  } finally {
    cleanup(monitor)
  }
})

test('supports pause, resume, stop, restart, and save shortcuts', async () => {
  const paused: string[] = []
  const resumed: string[] = []
  const stopped: string[] = []
  const restarted: string[] = []
  const saved: Array<[string, string]> = []
  const monitor = renderMonitor([
    run({ runId: 'active' }),
    run({ runId: 'paused', status: 'paused' }),
    run({ runId: 'done', status: 'completed', meta: { name: 'saved-workflow' } }),
  ], {
    onPause: async id => { paused.push(id); return true },
    onResume: async id => { resumed.push(id); return true },
    onStop: async id => { stopped.push(id); return true },
    onRestart: async id => { restarted.push(id) },
    onSave: async (id, name) => { saved.push([id, name]); return '/workflow.js' },
  })

  try {
    await Bun.sleep(100)
    await press(monitor.stdin, 'p')
    await press(monitor.stdin, '\x1b[B')
    await press(monitor.stdin, 'p')
    await press(monitor.stdin, '\x1b[A')
    await press(monitor.stdin, 'x')
    await press(monitor.stdin, '\x1b[B')
    await press(monitor.stdin, '\x1b[B')
    await press(monitor.stdin, 'r')
    await press(monitor.stdin, 's')
    await press(monitor.stdin, '\r')

    expect(paused).toEqual(['active'])
    expect(resumed).toEqual(['paused'])
    expect(stopped).toEqual(['active'])
    expect(restarted).toEqual(['done'])
    expect(saved).toEqual([['done', 'saved-workflow']])
  } finally {
    cleanup(monitor)
  }
})

test('agent drill-down shows the real prompt while labels stay short', async () => {
  const monitor = renderMonitor([run({
    phase: 'Alpha', phaseHistory: ['Alpha'], usage: { agents: 1, tokens: 1200, costUsd: 0 },
  })], {
    agents: [
      { id: 'red', task: 'alpha:red', prompt: 'Return exactly one single word about the colour red', status: 'done' as const, colorIndex: 0, toolCount: 0, lastToolInfo: null, startedAt: Date.now(), durationMs: 1_000, result: 'red', error: null, tokens: 1200, costUsd: 0, role: null, confidence: null, verified: null, agentName: null, model: 'deepseek-v4-flash', workflowRunId: 'workflow-run', workflowPhase: 'Alpha' },
    ],
  })
  let rendered = ''
  monitor.stdout.on('data', chunk => { rendered += chunk.toString() })

  try {
    await Bun.sleep(100)
    await press(monitor.stdin, '\r')
    rendered = ''
    await press(monitor.stdin, '\r')
    const plain = rendered.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\s/g, '')
    // The label keeps naming the agent in the left column and the panel title...
    expect(plain).toContain('a:red')
    expect(plain).toContain('Prompt')
    // ...while the Prompt section carries the instruction that was actually sent.
    expect(plain).toContain('Returnexactlyonesingleword')
  } finally {
    cleanup(monitor)
  }
})
