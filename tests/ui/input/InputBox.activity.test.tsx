import { expect, test } from 'bun:test'
import React from 'react'
import { PassThrough } from 'node:stream'
import { renderSync } from '../../../src/ink/root.js'
import { InputBox } from '../../../src/ui/input/InputBox.js'
import { setFullscreenActive } from '../../../src/utils/fullscreen.js'

class FakeTerminal extends PassThrough {
  isTTY = true
  isRaw = false
  columns = 100
  rows = 24
  setRawMode(enabled: boolean): this { this.isRaw = enabled; return this }
  ref(): this { return this }
  unref(): this { return this }
}

test('Down opens the activity footer from an empty input', async () => {
  const stdin = new FakeTerminal()
  const stdout = new FakeTerminal()
  let opened = 0
  const instance = renderSync(
    <InputBox
      onSubmit={() => {}}
      isLoading={false}
      toolCallCount={0}
      workingDirectory={process.cwd()}
      activityAvailable
      onActivityOpen={() => { opened++ }}
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
    stdin.write('\x1b[B')
    await Bun.sleep(100)
    expect(opened).toBe(1)
  } finally {
    stdout.isTTY = false
    instance.unmount()
    instance.cleanup()
  }
})

test('hides the fullscreen hint after the first input character', async () => {
  setFullscreenActive(true)
  const stdin = new FakeTerminal()
  const stdout = new FakeTerminal()
  const chunks: string[] = []
  stdout.on('data', chunk => chunks.push(String(chunk)))
  const instance = renderSync(
    <InputBox
      onSubmit={() => {}}
      isLoading={false}
      toolCallCount={0}
      workingDirectory={process.cwd()}
      showFullscreenHint
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
    const normalize = (raw: string) => raw
      .replace(/\x1b\[\d*C/g, ' ')
      .replace(/\x1b\[[?0-9;]*[a-zA-Z]/g, '')
    expect(normalize(chunks.join(''))).toContain("Don't like this screen? Change it in /config")
    chunks.length = 0

    stdin.write('a')
    await Bun.sleep(100)
    expect(normalize(chunks.join(''))).not.toContain("Don't like this screen? Change it in /config")
  } finally {
    setFullscreenActive(false)
    stdout.isTTY = false
    instance.unmount()
    instance.cleanup()
  }
})
