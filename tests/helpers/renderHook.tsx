import React from 'react'
import { PassThrough } from 'node:stream'
import { renderSync } from '../../src/ink/root.js'

class FakeTerminal extends PassThrough {
  isTTY = true
  isRaw = false
  columns = 80
  rows = 24
  setRawMode(enabled: boolean): this { this.isRaw = enabled; return this }
  ref(): this { return this }
  unref(): this { return this }
}

/** Renders a hook inside a real (headless) Ink tree; `rerender` renders it again, so state that should survive renders can be checked. */
export function renderHook<T>(hook: () => T): { result: { current: T }; rerender: () => void; unmount: () => void } {
  const result = { current: undefined as T }
  function Probe() {
    result.current = hook()
    return null
  }
  const stdin = new FakeTerminal()
  const stdout = new FakeTerminal()
  const instance = renderSync(<Probe />, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    exitOnCtrlC: false,
    patchConsole: false,
  })
  return {
    result,
    rerender: () => instance.rerender(<Probe />),
    unmount: () => {
      instance.unmount()
      instance.cleanup()
      stdin.isTTY = false
      stdout.isTTY = false
    },
  }
}
