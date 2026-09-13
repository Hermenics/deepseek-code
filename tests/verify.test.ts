import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectVerificationCommand, runVerification } from '../src/agent/verify.js'

const dirs: string[] = []

async function bunProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsk-verify-'))
  dirs.push(dir)
  await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'bun test' } }))
  await writeFile(join(dir, 'bun.lock'), '')
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true })
    await writeFile(join(dir, path), content)
  }
  return dir
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('runVerification', () => {
  it('does not report a project without tests as a failed verification', async () => {
    const dir = await bunProject({ 'src/a.ts': 'export const a = 1\n' })
    const command = await detectVerificationCommand(dir)
    expect(command?.display).toBe('bun test')

    const result = await runVerification(command!, dir)

    expect(result.ok).toBe(true)
    expect(result.output).toContain('0 test files matching')
  })

  it('recognizes the no-tests message when the runner prints colors', async () => {
    const dir = await bunProject({ 'src/a.ts': 'export const a = 1\n' })
    const previous = process.env.FORCE_COLOR
    process.env.FORCE_COLOR = '1'
    try {
      const result = await runVerification((await detectVerificationCommand(dir))!, dir)

      expect(result.ok).toBe(true)
      expect(result.output).not.toContain('\x1b[')
    } finally {
      if (previous === undefined) delete process.env.FORCE_COLOR
      else process.env.FORCE_COLOR = previous
    }
  })

  it('reports a test file that fails to import as a failure', async () => {
    const dir = await bunProject({ 'test/a.test.ts': "import { missing } from '../src/nope'\nconsole.log(missing)\n" })

    const result = await runVerification((await detectVerificationCommand(dir))!, dir)

    expect(result.ok).toBe(false)
  })

  it('still reports a failing test as a failure', async () => {
    const dir = await bunProject({ 'test/a.test.ts': "import { expect, it } from 'bun:test'\nit('fails', () => expect(1).toBe(2))\n" })

    const result = await runVerification((await detectVerificationCommand(dir))!, dir)

    expect(result.ok).toBe(false)
  })
})
