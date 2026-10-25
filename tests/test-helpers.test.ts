import { expect, test } from 'bun:test'
import { waitFor } from './helpers/waitFor.js'
import { waitForChildFile } from './helpers/waitForChildFile.js'
import { removeTempDirectory } from './helpers/removeTempDirectory.js'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('waitFor accepts sync and async readiness without a minimum sleep', async () => {
  await waitFor(() => true, 'already ready', 0)
  let probes = 0
  await waitFor(async () => ++probes === 3, 'async readiness')
  expect(probes).toBe(3)
})

test('waitFor reports the missing condition and propagates predicate failures', async () => {
  await expect(waitFor(() => false, 'worker permission request', 0)).rejects.toThrow('worker permission request (0ms)')
  await expect(waitFor(() => { throw new Error('fixture crashed') }, 'fixture')).rejects.toThrow('fixture crashed')
})

test('waitFor bounds stalled predicates and rejects results delivered after the deadline', async () => {
  await expect(waitFor(() => new Promise<boolean>(() => {}), 'stalled predicate', 20)).rejects.toThrow('stalled predicate (20ms)')
  await expect(waitFor(async () => {
    await Promise.resolve()
    const until = performance.now() + 30
    while (performance.now() < until) { /* Block timers to exercise the post-resolution deadline check. */ }
    return true
  }, 'late readiness', 10)).rejects.toThrow('late readiness (10ms)')
  await expect(waitFor(async () => { throw new Error('async fixture crashed') }, 'fixture')).rejects.toThrow('async fixture crashed')
}, 2000)

test('child readiness works with spaces and Unicode in the marker path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek helper é '))
  const marker = join(directory, 'ready marker')
  const child = Bun.spawn([process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ready')`], {
    stdin: 'ignore', stdout: 'ignore', stderr: 'pipe',
  })
  try {
    await waitForChildFile(marker, child, new Response(child.stderr).text())
    expect(await child.exited).toBe(0)
  } finally {
    if (child.exitCode === null) child.kill()
    await child.exited
    await removeTempDirectory(directory)
  }
})

test('child readiness reports an early exit with its stderr instead of a generic timeout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-child-exit-'))
  const child = Bun.spawn([process.execPath, '-e', 'console.error("fixture failed to start"); process.exit(7)'], {
    stdin: 'ignore', stdout: 'ignore', stderr: 'pipe',
  })
  try {
    await expect(waitForChildFile(join(directory, 'never'), child, new Response(child.stderr).text()))
      .rejects.toThrow('fixture failed to start')
    expect(await child.exited).toBe(7)
  } finally {
    if (child.exitCode === null) child.kill()
    await child.exited
    await removeTempDirectory(directory)
  }
})
