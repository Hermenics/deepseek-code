import { afterAll, beforeAll, expect, test } from 'bun:test'
import React from 'react'
import { PassThrough } from 'node:stream'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderSync } from '../../../src/ink/root.js'
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

const MULTI = 'multi line one\nmulti line two\nmulti line three'
const originalHome = process.env.HOME
let home = ''

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'ds-history-'))
  mkdirSync(join(home, '.deepseek'))
  // Oldest first; ↑ starts from the newest.
  writeFileSync(join(home, '.deepseek', 'input_history.json'), JSON.stringify(['old one', MULTI, 'newest']))
  process.env.HOME = home
})
afterAll(() => {
  process.env.HOME = originalHome
  rmSync(home, { recursive: true, force: true })
})

/** Presses `keys` one at a time on a fresh input and returns what Enter submits. */
async function submitAfter(keys: string[]): Promise<string> {
  const stdin = new FakeTerminal()
  const stdout = new FakeTerminal()
  const submitted: string[] = []
  const instance = renderSync(
    <InputBox onSubmit={text => { submitted.push(text) }} isLoading={false} toolCallCount={0} workingDirectory={process.cwd()} />,
    { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, stderr: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false },
  )
  try {
    await Bun.sleep(150)
    for (const key of [...keys, '\r']) { stdin.write(key); await Bun.sleep(40) }
    return submitted[0] ?? ''
  } finally {
    stdout.isTTY = false
    instance.unmount()
    instance.cleanup()
  }
}

const UP = '\x1b[A'
const DOWN = '\x1b[B'

test('repeated ↑ keeps walking history across a multi-line entry (it lands on its first line)', async () => {
  expect(await submitAfter([UP, UP, UP])).toBe('old one')
})

test('moving through a recalled entry does not restart history, so ↓ from its last line goes newer', async () => {
  expect(await submitAfter([UP, UP, DOWN, DOWN, DOWN])).toBe('newest')
})
