import { describe, expect, test } from 'bun:test'
import { EventEmitter } from 'events'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { LAUNCHER_SOURCE } from '../scripts/launcher.js'
import { exitWhenTerminalCloses, HANGUP_EXIT_CODE } from '../src/utils/terminalLoss.js'

describe('exitWhenTerminalCloses', () => {
  for (const [label, trigger] of [
    ['SIGHUP', (_stdin: EventEmitter, proc: EventEmitter) => proc.emit('SIGHUP')],
    ['stdin EOF', (stdin: EventEmitter) => stdin.emit('end')],
    ['stdin EIO', (stdin: EventEmitter) => stdin.emit('error', Object.assign(new Error('EIO'), { code: 'EIO' }))],
  ] as const) {
    test(`exits with the hang-up code on ${label}`, () => {
      const stdin = new EventEmitter()
      const proc = new EventEmitter()
      const codes: number[] = []
      exitWhenTerminalCloses(code => codes.push(code), stdin, proc as unknown as NodeJS.Process)
      trigger(stdin, proc)
      expect(codes).toEqual([HANGUP_EXIT_CODE])
    })
  }
})

describe('launcher', () => {
  // Regression: the launcher used to register SIGHUP/SIGTERM listeners that only
  // restored the terminal, which cancels the default exit and orphaned the app.
  for (const signal of ['SIGTERM', 'SIGHUP'] as const) {
    // Windows has no SIGHUP: sending it throws, and a closed console ends the process there anyway.
    test.skipIf(signal === 'SIGHUP' && process.platform === 'win32')(`does not keep the process alive after ${signal}`, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'ds-launcher-'))
      try {
        writeFileSync(join(dir, 'deepseek.mjs'), LAUNCHER_SOURCE)
        // An app with no signal handling of its own, kept alive by a timer.
        writeFileSync(join(dir, 'cli.mjs'), 'setInterval(() => {}, 1000); console.log("ready")\n')
        const child = Bun.spawn(['bun', join(dir, 'deepseek.mjs')], { stdout: 'pipe', stderr: 'pipe' })
        const reader = child.stdout.getReader()
        await reader.read() // wait until the fake app is running
        child.kill(signal)
        const exited = await Promise.race([child.exited.then(() => true), Bun.sleep(3000).then(() => false)])
        if (!exited) child.kill('SIGKILL')
        expect(exited).toBe(true)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  }
})
