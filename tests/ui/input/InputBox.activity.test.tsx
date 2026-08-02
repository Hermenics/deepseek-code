import { expect, test } from 'bun:test'
import React from 'react'
import { PassThrough } from 'node:stream'
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
