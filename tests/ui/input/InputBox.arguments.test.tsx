import { expect, spyOn, test } from 'bun:test'
import React from 'react'
import { PassThrough } from 'node:stream'
import { renderSync } from '../../../src/ink/root.js'
import * as inputHistoryModule from '../../../src/agent/inputHistory.js'
import * as sessionModule from '../../../src/agent/session.js'
import { InputBox } from '../../../src/ui/input/InputBox.js'

class FakeTerminal extends PassThrough {
  isTTY = true
  isRaw = false
  columns = 100
  rows = 24
  setRawMode(enabled: boolean): this { this.isRaw = enabled; return this }
  ref(): this { return this }
  unref(): this { return this }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

test('argument and command suggestions fill the input without executing a command', async () => {
  const stdin = new FakeTerminal()
  const stdout = new FakeTerminal()
  const submitted: string[] = []
  const instance = renderSync(
    <InputBox onSubmit={text => submitted.push(text)} isLoading={false} toolCallCount={0} workingDirectory={process.cwd()} />,
    { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, stderr: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false },
  )

  try {
    await Bun.sleep(100)
    stdin.write('/catalog m')
    await Bun.sleep(300)
    stdin.write('\r')
    await Bun.sleep(100)
    expect(submitted).toEqual([])
    stdin.write('\r')
    await Bun.sleep(100)
    expect(submitted).toHaveLength(1)
    expect(submitted[0]?.trim()).toBe('/catalog mcp')
  } finally {
    stdout.isTTY = false
    instance.unmount()
    instance.cleanup()
  }
})

test('selecting a slash-command suggestion only inserts it for editing', async () => {
  const stdin = new FakeTerminal()
  const stdout = new FakeTerminal()
  const submitted: string[] = []
  const instance = renderSync(
    <InputBox onSubmit={text => submitted.push(text)} isLoading={false} toolCallCount={0} workingDirectory={process.cwd()} />,
    { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, stderr: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false },
  )

  try {
    await Bun.sleep(100)
    stdin.write('/do')
    await Bun.sleep(300)
    stdin.write('\r')
    await Bun.sleep(100)
    expect(submitted).toEqual([])
    stdin.write('\r')
    await Bun.sleep(100)
    expect(submitted.map(value => value.trim())).toEqual(['/doctor'])
  } finally {
    stdout.isTTY = false
    instance.unmount()
    instance.cleanup()
  }
})

test('accepting a command suggestion resets recalled history navigation', async () => {
  const stdin = new FakeTerminal()
  const stdout = new FakeTerminal()
  const submitted: string[] = []
  const history = spyOn(inputHistoryModule, 'loadInputHistory').mockResolvedValue(['older command', '/doctor'])
  const instance = renderSync(
    <InputBox onSubmit={text => submitted.push(text)} isLoading={false} toolCallCount={0} workingDirectory={process.cwd()} />,
    { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, stderr: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false },
  )

  try {
    await Bun.sleep(50)
    stdin.write('\x1b[A')
    await Bun.sleep(50)
    stdin.write('\r')
    await Bun.sleep(50)
    stdin.write('\x1b[A')
    await Bun.sleep(50)
    stdin.write('\r')
    await Bun.sleep(50)
    expect(submitted).toEqual([])
  } finally {
    history.mockRestore()
    stdout.isTTY = false
    instance.unmount()
    instance.cleanup()
  }
})

test('accepting an argument suggestion resets recalled history navigation', async () => {
  const stdin = new FakeTerminal()
  const stdout = new FakeTerminal()
  const submitted: string[] = []
  const history = spyOn(inputHistoryModule, 'loadInputHistory').mockResolvedValue(['older command', '/catalog m'])
  const instance = renderSync(
    <InputBox onSubmit={text => submitted.push(text)} isLoading={false} toolCallCount={0} workingDirectory={process.cwd()} />,
    { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, stderr: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false },
  )

  try {
    await Bun.sleep(50)
    stdin.write('\x1b[A')
    await Bun.sleep(100)
    stdin.write('\x1b[F')
    await Bun.sleep(50)
    stdin.write('\r')
    await Bun.sleep(50)
    stdin.write('\x1b[A')
    await Bun.sleep(100)
    stdin.write('\x1b[F')
    await Bun.sleep(50)
    stdin.write('\r')
    await Bun.sleep(50)
    expect(submitted).toEqual([])
  } finally {
    history.mockRestore()
    stdout.isTTY = false
    instance.unmount()
    instance.cleanup()
  }
})

test('Enter submits while async argument suggestions are pending and ignores their stale result', async () => {
  const stdin = new FakeTerminal()
  const stdout = new FakeTerminal()
  const submitted: string[] = []
  const searchStarted = deferred<void>()
  const searchResult = deferred<Awaited<ReturnType<typeof sessionModule.listSessions>>>()
  const workingDirectory = `/tmp/input-box-completion-race-${crypto.randomUUID()}`
  const sessions = spyOn(sessionModule, 'listSessions').mockImplementation(async () => {
    searchStarted.resolve()
    return searchResult.promise
  })
  const instance = renderSync(
    <InputBox onSubmit={text => { if (text.trim()) submitted.push(text) }} isLoading={false} toolCallCount={0} workingDirectory={workingDirectory} />,
    { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, stderr: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false },
  )

  try {
    await Bun.sleep(50)
    stdin.write('/sessions export ')
    await searchStarted.promise
    await Bun.sleep(50)

    stdin.write('\r')
    await Bun.sleep(50)
    expect(submitted.map(value => value.trim())).toEqual(['/sessions export'])

    searchResult.resolve([{
      id: 'a1b2c3d4e5f6', cwd: workingDirectory, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      model: 'local', provider: 'local', language: null, activeAgent: null, agentMessages: [], uiMessages: [], filesModified: [],
    }])
    await Bun.sleep(50)

    // Tab would accept a stale completion if the pending result leaked into the empty input.
    stdin.write('\t')
    await Bun.sleep(50)
    stdin.write('\r')
    await Bun.sleep(50)
    expect(submitted.map(value => value.trim())).toEqual(['/sessions export'])
  } finally {
    searchResult.resolve([])
    sessions.mockRestore()
    stdout.isTTY = false
    instance.unmount()
    instance.cleanup()
  }
})
