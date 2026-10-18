import { afterEach, expect, it, spyOn } from 'bun:test'
import React from 'react'
import { PassThrough } from 'node:stream'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import * as os from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent, type AgentCallbacks } from '../../src/agent/agent.js'
import { getGoal, setGoal } from '../../src/agent/goal.js'
import { renderSync } from '../../src/ink/root.js'
import { App } from '../../src/ui/App.js'
import { writeIgnoreDefaults } from '../../src/tools/shared/deepseekignore.js'

class FakeTerminal extends PassThrough {
  isTTY = true
  isRaw = false
  columns = 100
  rows = 30
  setRawMode(enabled: boolean): this { this.isRaw = enabled; return this }
  ref(): this { return this }
  unref(): this { return this }
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(complete => { resolve = complete })
  return { promise, resolve }
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${message}`)
    await Bun.sleep(10)
  }
}

async function typeAndSubmit(stdin: FakeTerminal, text: string): Promise<void> {
  for (const key of text) {
    stdin.write(key)
    await Bun.sleep(10)
  }
  stdin.write('\r')
  await Bun.sleep(100)
}

const roots: string[] = []
const instances: Array<ReturnType<typeof renderSync>> = []
let restoreHomedir: (() => void) | undefined
let priorHome: string | undefined
let priorUserProfile: string | undefined

afterEach(async () => {
  restoreHomedir?.()
  restoreHomedir = undefined
  for (const instance of instances.splice(0)) {
    instance.unmount()
    instance.cleanup()
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  if (priorHome === undefined) delete process.env.HOME
  else process.env.HOME = priorHome
  if (priorUserProfile === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = priorUserProfile
})

async function renderApp(initialMessage: string) {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-steering-'))
  roots.push(root)
  const home = join(root, 'home')
  const project = join(root, 'project')
  await Promise.all([mkdir(home, { recursive: true }), mkdir(project, { recursive: true })])
  writeIgnoreDefaults(project)
  priorHome = process.env.HOME
  priorUserProfile = process.env.USERPROFILE
  process.env.HOME = home
  process.env.USERPROFILE = home
  const homedirSpy = spyOn(os, 'homedir').mockReturnValue(home)
  restoreHomedir = () => homedirSpy.mockRestore()

  const stdin = new FakeTerminal()
  const stdout = new FakeTerminal()
  const instance = renderSync(
    <App
      theme="dark"
      providerConfig={{ provider: 'local', localBaseUrl: 'http://127.0.0.1:1/v1', localModel: 'steering-test' }}
      initialSession={{ cwd: project, goal: null } as never}
      initialMessage={initialMessage}
      initialSettings={{ interaction: { defaultMode: 'plan' }, promptRefiner: { enabled: false } }}
      workspaceTrusted
    />,
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  )
  instances.push(instance)
  return { stdin, stdout }
}

it('steers without a goal, waits for the active run, and precedes ordinary queued input', async () => {
  setGoal(null)
  const activeRun = deferred<void>()
  const runs: Array<{
    agent: Agent
    prompt: string
    callbacks: AgentCallbacks
    settled: boolean
    startedAfterPriorSettled: boolean
  }> = []
  const runSpy = spyOn(Agent.prototype, 'run').mockImplementation(function (this: Agent, userMessage, callbacks) {
    const prompt = typeof userMessage === 'string' ? userMessage : userMessage.text
    const prior = runs.at(-1)
    const run = {
      agent: this,
      prompt,
      callbacks,
      settled: false,
      startedAfterPriorSettled: prior?.settled ?? true,
    }
    runs.push(run)
    if (runs.length === 1) {
      return activeRun.promise.then(() => {
        run.settled = true
        callbacks.onDone()
      })
    }
    run.settled = true
    callbacks.onToken(`RUN_${runs.length}_FINISHED`)
    callbacks.onDone()
    return Promise.resolve()
  })
  const ui = await renderApp('INITIAL_TASK_MARKER')

  try {
    await waitFor(() => runs.length === 1, 'the initial Agent.run call')
    expect(getGoal()).toBeNull()
    const initialEpoch = runs[0]!.agent.getObjectiveEpoch()

    await typeAndSubmit(ui.stdin, 'ORDINARY_QUEUE_MARKER')
    await typeAndSubmit(ui.stdin, '/steer STEERING_CORRECTION_MARKER')
    await waitFor(() => runs[0]!.agent.getObjectiveEpoch() === initialEpoch + 1, 'the objective epoch to advance')

    expect(runs).toHaveLength(1)
    expect(runs[0]!.settled).toBe(false)
    expect(getGoal()).toBeNull()

    activeRun.resolve()
    await waitFor(() => runs.length >= 3, 'the correction and queued prompt to run')

    expect(runs[1]!.startedAfterPriorSettled).toBe(true)
    expect(runs[1]!.prompt).toContain('STEERING_CORRECTION_MARKER')
    expect(runs[1]!.prompt).not.toContain('ORDINARY_QUEUE_MARKER')
    expect(runs[2]!.startedAfterPriorSettled).toBe(true)
    expect(runs[2]!.prompt).toContain('ORDINARY_QUEUE_MARKER')
    expect(runs[1]!.agent.getObjectiveEpoch()).toBe(initialEpoch + 1)
  } finally {
    activeRun.resolve()
    runSpy.mockRestore()
    ui.stdout.isTTY = false
  }
}, 15_000)

it('keeps a dequeued ordinary prompt queued when steering replaces its pending timer', async () => {
  setGoal(null)
  const activeRun = deferred<void>()
  const runs: Array<{ prompt: string }> = []
  const runSpy = spyOn(Agent.prototype, 'run').mockImplementation(function (this: Agent, userMessage, callbacks) {
    const prompt = typeof userMessage === 'string' ? userMessage : userMessage.text
    runs.push({ prompt })
    if (runs.length === 1) {
      return activeRun.promise.then(() => callbacks.onDone())
    }
    callbacks.onDone()
    return Promise.resolve()
  })
  const originalSetTimeout = globalThis.setTimeout
  let interceptQueueTimer = false
  let heldQueueTimer: ReturnType<typeof setTimeout> | undefined
  let capturedQueueCallback: (() => void) | undefined
  const timerSpy = spyOn(globalThis, 'setTimeout').mockImplementation((function (
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) {
    if (interceptQueueTimer && delay === 0) {
      interceptQueueTimer = false
      capturedQueueCallback = () => callback(...args)
      heldQueueTimer = originalSetTimeout(() => {}, 60_000)
      return heldQueueTimer
    }
    return originalSetTimeout(callback, delay, ...args)
  }) as typeof setTimeout)
  const ui = await renderApp('INITIAL_TASK_MARKER')

  try {
    await waitFor(() => runs.length === 1, 'the initial Agent.run call')
    await typeAndSubmit(ui.stdin, 'DEQUEUED_ORDINARY_MARKER')
    interceptQueueTimer = true
    activeRun.resolve()
    await waitFor(() => capturedQueueCallback !== undefined, 'the queued prompt dispatch timer')

    await typeAndSubmit(ui.stdin, '/steer TIMER_RACE_CORRECTION_MARKER')
    await waitFor(() => runs.some(run => run.prompt.includes('TIMER_RACE_CORRECTION_MARKER')), 'the steering correction to run')
    await waitFor(() => runs.some(run => run.prompt.includes('DEQUEUED_ORDINARY_MARKER')), 'the retained ordinary prompt to run')

    expect(runs.findIndex(run => run.prompt.includes('TIMER_RACE_CORRECTION_MARKER')))
      .toBeLessThan(runs.findIndex(run => run.prompt.includes('DEQUEUED_ORDINARY_MARKER')))
  } finally {
    activeRun.resolve()
    if (heldQueueTimer) clearTimeout(heldQueueTimer)
    timerSpy.mockRestore()
    runSpy.mockRestore()
    ui.stdout.isTTY = false
  }
}, 15_000)

it('/btw answers immediately without aborting or replacing the active run', async () => {
  setGoal(null)
  const activeRun = deferred<void>()
  const runs: Array<{ agent: Agent; settled: boolean }> = []
  const runSpy = spyOn(Agent.prototype, 'run').mockImplementation(function (this: Agent) {
    const run = { agent: this, settled: false }
    runs.push(run)
    return activeRun.promise.then(() => { run.settled = true })
  })
  const askBtwSpy = spyOn(Agent.prototype, 'askBtw').mockResolvedValue('BTW_RESPONSE_MARKER')
  const abortSpy = spyOn(Agent.prototype, 'abort')
  const ui = await renderApp('INITIAL_TASK_MARKER')

  try {
    await waitFor(() => runs.length === 1, 'the initial Agent.run call')
    const initialEpoch = runs[0]!.agent.getObjectiveEpoch()
    await typeAndSubmit(ui.stdin, '/btw SIDE_QUESTION_MARKER')
    await waitFor(() => askBtwSpy.mock.calls.length === 1, 'the immediate side-question request')

    expect(askBtwSpy).toHaveBeenCalledWith('SIDE_QUESTION_MARKER', expect.any(AbortSignal))
    await expect(askBtwSpy.mock.results[0]!.value).resolves.toBe('BTW_RESPONSE_MARKER')
    expect(runs).toHaveLength(1)
    expect(runs[0]!.settled).toBe(false)
    expect(runs[0]!.agent.getObjectiveEpoch()).toBe(initialEpoch)
    expect(abortSpy).not.toHaveBeenCalled()
  } finally {
    activeRun.resolve()
    runSpy.mockRestore()
    askBtwSpy.mockRestore()
    abortSpy.mockRestore()
    ui.stdout.isTTY = false
  }
}, 15_000)
