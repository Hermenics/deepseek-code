import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertCheckerSandboxAvailable, runIsolatedChecker } from '../scripts/eval/checker.js'
import { sandboxAvailable } from '../src/utils/platform.js'

const fixtureDirs: string[] = []
const originalApiKey = process.env.DEEPSEEK_API_KEY
const sandboxTest = it.skipIf(!sandboxAvailable())

afterEach(async () => {
  if (originalApiKey === undefined) delete process.env.DEEPSEEK_API_KEY
  else process.env.DEEPSEEK_API_KEY = originalApiKey
  await Promise.all(fixtureDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'eval-checker-fixture-'))
  fixtureDirs.push(dir)
  return dir
}

describe('isolated eval checker', () => {
  sandboxTest('drops provider canaries and uses a cleaned HOME/TMPDIR outside the fixture', async () => {
    const dir = await fixture()
    const canary = 'sk-test-eval-secret-canary-7193'
    process.env.DEEPSEEK_API_KEY = canary
    const result = await runIsolatedChecker(['-e', "console.log(JSON.stringify({ key: process.env.DEEPSEEK_API_KEY ?? null, home: process.env.HOME, temp: process.env.TMPDIR }))"], dir)

    expect(result.exitCode).toBe(0)
    expect(result.all).not.toContain(canary)
    const reported = JSON.parse(result.all.trim()) as { key: string | null; home: string; temp: string }
    expect(reported.key).toBeNull()
    expect(reported.home).not.toBe(dir)
    expect(reported.temp).not.toBe(dir)
    expect(reported.home).not.toContain(dir)
    expect(reported.temp).not.toContain(dir)
    expect(existsSync(reported.home)).toBe(false)
    expect(existsSync(reported.temp)).toBe(false)
  })

  sandboxTest('blocks absolute host paths outside the fixture mount', async () => {
    const dir = await fixture()
    const outside = await mkdtemp(join(tmpdir(), 'eval-checker-secret-'))
    fixtureDirs.push(outside)
    const canary = 'absolute-home-secret-canary-4931'
    const secretFile = join(outside, 'user-config.json')
    await writeFile(secretFile, canary)
    const script = `try { console.log(require('node:fs').readFileSync(${JSON.stringify(secretFile)}, 'utf8')) } catch { console.log('blocked') }`
    const result = await runIsolatedChecker(['-e', script], dir)

    expect(result.exitCode).toBe(0)
    expect(result.all).toContain('blocked')
    expect(result.all).not.toContain(canary)
  })

  sandboxTest('rejects a successful no-op runner without executed-test evidence', async () => {
    const dir = await fixture()
    const result = await runIsolatedChecker(['-e', "console.log('runner finished')"], dir)

    expect(result.exitCode).toBe(0)
    expect(result.testCount).toBeNull()
    expect(result.positiveTestEvidence).toBe(false)
  })

  sandboxTest('does not let a non-Bun footer replace an empty Bun summary', async () => {
    const dir = await fixture()
    const result = await runIsolatedChecker(['-e', "console.log('0 pass\\n0 fail\\nRan 0 tests across 0 files.'); console.log('1 passed in 0.01s')"], dir)

    expect(result.exitCode).toBe(0)
    expect(result.testCount).toBe(0)
    expect(result.positiveTestEvidence).toBe(false)
  })

  sandboxTest('recognizes a passing local test suite as positive evidence', async () => {
    const dir = await fixture()
    await mkdir(join(dir, 'test'))
    await writeFile(join(dir, 'test', 'example.test.ts'), "import { expect, test } from 'bun:test'; test('fixture works', () => expect(2 + 2).toBe(4))\n")
    const result = await runIsolatedChecker(['test'], dir)

    expect(result.exitCode).toBe(0)
    expect(result.testCount).toBe(1)
    expect(result.positiveTestEvidence).toBe(true)
  })

  sandboxTest('keeps frozen hidden checks read-only while leaving the task workspace writable', async () => {
    const dir = await fixture()
    const checker = join(dir, '__eval_check__')
    await mkdir(checker)
    await writeFile(join(checker, 'frozen.txt'), 'original')
    await writeFile(join(dir, 'workspace.txt'), 'before')
    await writeFile(join(checker, 'readonly.test.ts'), `import { expect, test } from 'bun:test'\nimport { writeFileSync } from 'node:fs'\nimport { join } from 'node:path'\ntest('checker is frozen but the workspace remains writable', () => {\n  expect(() => writeFileSync(join(process.cwd(), '__eval_check__/frozen.txt'), 'tampered')).toThrow()\n  writeFileSync(join(process.cwd(), 'workspace.txt'), 'updated')\n})\n`)

    const result = await runIsolatedChecker(['test', './__eval_check__'], dir, { readOnlyPaths: ['__eval_check__'] })

    expect(result.exitCode).toBe(0)
    expect(result.testCount).toBe(1)
    expect(result.positiveTestEvidence).toBe(true)
    expect(await Bun.file(join(checker, 'frozen.txt')).text()).toBe('original')
    expect(await Bun.file(join(dir, 'workspace.txt')).text()).toBe('updated')
  })

  it('fails closed when the platform cannot provide bubblewrap containment', () => {
    if (sandboxAvailable()) expect(() => assertCheckerSandboxAvailable()).not.toThrow()
    else expect(() => assertCheckerSandboxAvailable()).toThrow(/requires Linux bubblewrap filesystem containment/)
  })
})
