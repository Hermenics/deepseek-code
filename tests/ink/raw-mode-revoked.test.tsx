/**
 * A terminal can go away while the app is still running — the window is
 * closed, an SSH session drops, a pty gets recycled. `stdin.isTTY` does not
 * notice: it is decided when the stream is built and never revised, so it
 * keeps reporting a live terminal and the termios ioctl is left to be the
 * one that objects, by throwing EIO.
 *
 * Raw mode is reached from inside effects, so that throw used to unmount the
 * render tree and replace the session with a stack trace.
 */
import { describe, expect, it } from 'bun:test'
import { EventEmitter } from 'node:events'
import App from '../../src/ink/components/App.js'

/** A stdin whose termios ioctl always refuses, and a count of the attempts. */
function revokedStdin(): { stdin: NodeJS.ReadStream; calls: () => number } {
  let calls = 0
  const stream = new EventEmitter() as unknown as NodeJS.ReadStream
  stream.isTTY = true // still true: the value was captured before the hangup
  stream.setEncoding = () => stream
  stream.ref = () => stream
  stream.unref = () => stream
  stream.setRawMode = () => {
    calls++
    const error = new Error('setRawMode EIO') as NodeJS.ErrnoException
    error.code = 'EIO'
    error.errno = -5
    throw error
  }
  return { stdin: stream, calls: () => calls }
}

function app(stdin: NodeJS.ReadStream): App {
  const written: string[] = []
  const stdout = { isTTY: true, write: (text: string) => { written.push(text); return true } } as unknown as NodeJS.WriteStream
  // Only the members handleSetRawMode touches are needed; the rest of the
  // tree never renders in this test.
  return new App({
    children: null, stdin, stdout, stderr: stdout, exitOnCtrlC: true,
    onExit: () => {}, terminalColumns: 80, terminalRows: 24,
    selection: {} as never, onSelectionChange: () => {}, onClickAt: () => false,
  } as never)
}

describe('raw mode on a terminal that has gone away', () => {
  it('does not throw when the ioctl reports EIO', () => {
    const instance = app(revokedStdin().stdin)
    expect(() => instance.handleSetRawMode(true)).not.toThrow()
  })

  it('stops reporting raw mode as supported once it has failed', () => {
    const instance = app(revokedStdin().stdin)
    expect(instance.isRawModeSupported()).toBe(true)
    instance.handleSetRawMode(true)
    expect(instance.isRawModeSupported()).toBe(false)
  })

  it('does not keep retrying the dead ioctl', () => {
    const { stdin, calls } = revokedStdin()
    const instance = app(stdin)
    instance.handleSetRawMode(true)
    instance.handleSetRawMode(true)
    instance.handleSetRawMode(false)
    expect(calls()).toBe(1)
  })

  it('leaves no phantom raw-mode count behind', () => {
    const instance = app(revokedStdin().stdin)
    instance.handleSetRawMode(true)
    // A failed enable that still counted would make the matching disable
    // drop the count to zero and run the restore path against a dead fd.
    expect(instance.rawModeEnabledCount).toBe(0)
  })

  it('survives a hangup that happens between enabling and restoring', () => {
    let alive = true
    const stream = new EventEmitter() as unknown as NodeJS.ReadStream
    stream.isTTY = true
    stream.setEncoding = () => stream
    stream.ref = () => stream
    stream.unref = () => stream
    stream.setRawMode = () => {
      if (alive) return stream
      const error = new Error('setRawMode EIO') as NodeJS.ErrnoException
      error.code = 'EIO'
      throw error
    }

    const instance = app(stream)
    instance.handleSetRawMode(true)
    expect(instance.rawModeEnabledCount).toBe(1)

    alive = false // the terminal closes while the app is running
    expect(() => instance.handleSetRawMode(false)).not.toThrow()
    expect(instance.isRawModeSupported()).toBe(false)
  })

  it('still rejects a stdin that was never a terminal', () => {
    const stream = new EventEmitter() as unknown as NodeJS.ReadStream
    stream.isTTY = false
    const instance = app(stream)
    // A pipe is a caller mistake, not a hangup, and must stay loud.
    expect(() => instance.handleSetRawMode(true)).toThrow(/Raw mode is not supported/)
  })
})
