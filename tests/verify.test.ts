import { afterEach, describe, expect, it } from 'bun:test'
import { chmod, mkdtemp, mkdir, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureVerificationFingerprint, currentVerificationFingerprint, detectVerificationCommand, isPassedVerificationForWorkspace, runVerification, verificationTestCount } from '../src/agent/verify.js'
import { captureWorkspaceVersion } from '../src/agent/workspaceVersion.js'
import { execa } from 'execa'

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

async function writeFakeExecutable(path: string, lines: string[]): Promise<void> {
  const script = process.platform === 'win32'
    ? `@echo off\r\n${lines.map(line => `echo ${line}`).join('\r\n')}\r\n`
    : `#!/bin/sh\n${lines.map(line => `echo '${line}'`).join('\n')}\n`
  await writeFile(path, script)
  await chmod(path, 0o755)
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('runVerification', () => {
  it('does not pass provider credentials to project test scripts', async () => {
    const dir = await bunProject({})
    const previous = process.env.DEEPSEEK_API_KEY
    process.env.DEEPSEEK_API_KEY = 'synthetic-verification-canary'
    try {
      const result = await runVerification({ command: 'bun', args: ['-e', "console.log(process.env.DEEPSEEK_API_KEY ?? 'provider key absent')"], display: 'environment check' }, dir)
      expect(result.output).toContain('provider key absent')
      expect(result.output).not.toContain('synthetic-verification-canary')
    } finally {
      if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
      else process.env.DEEPSEEK_API_KEY = previous
    }
  })
  it('requires positive test evidence and recognizes common runner summaries', async () => {
    const dir = await bunProject({})
    const result = await runVerification({ command: 'bun', args: ['-e', "console.log('setup complete')"], display: 'no-op test script' }, dir)
    expect(result.status).toBe('inconclusive')
    expect(result.ok).toBe(false)
    expect(verificationTestCount('Tests: 2 skipped, 3 passed, 1 failed, 6 total')).toBe(4)
    expect(verificationTestCount(' Tests  3 passed (3)')).toBe(3)
    expect(verificationTestCount('  4 passing (12ms)')).toBe(4)
    expect(verificationTestCount('test result: ok. 2 passed; 0 failed; 1 ignored;')).toBe(2)
    expect(verificationTestCount('{"Action":"run","Test":"TestOne"}\n{"Action":"pass","Test":"TestOne"}')).toBe(1)
    expect(verificationTestCount('1 pass\n0 pass\n0 fail\n1 skip\n0 expect() calls\nRan 1 test across 1 file.')).toBe(0)
    expect(verificationTestCount('1 pass\r\n0 fail\r\nRan 1 test across 1 file.\r\n', 'bun')).toBe(1)
    expect(verificationTestCount('1 pass')).toBeNull()
    expect(verificationTestCount('0 passed')).toBe(0)
    expect(verificationTestCount('1 passed\n1 skipped in 0.01s')).toBe(0)
    expect(verificationTestCount('1 passed\n1 deselected in 0.01s')).toBe(0)
  })
  it('does not accept a package script that only prints a passing summary', async () => {
    const dir = await bunProject({})
    await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { test: "echo '1 pass'" } }))
    const command = await detectVerificationCommand(dir)
    const result = await runVerification(command!, dir)

    expect(result.output).toContain('1 pass')
    expect(result.status).toBe('inconclusive')
    expect(result.ok).toBe(false)
    expect(result.testCount).toBeNull()
    expect(isPassedVerificationForWorkspace(result, result.inputDigest ?? '', result.executionFingerprint)).toBe(false)
  })
  it('binds network policy into the verification fingerprint and receipt refresh', async () => {
    const dir = await bunProject({})
    const command = (await detectVerificationCommand(dir))!
    const execute = async () => ({ exitCode: 0, all: '1 pass\n0 fail\nRan 1 test across 1 file.' })
    const isolated = await runVerification(command, dir, { execute, allowNetwork: false })
    const networked = await runVerification(command, dir, { execute, allowNetwork: true })

    expect(isolated.status).toBe('passed')
    expect(networked.status).toBe('passed')
    expect(isolated.executionFingerprint).not.toBe(networked.executionFingerprint)
    expect(networked.allowNetwork).toBe(true)
    expect(await currentVerificationFingerprint(networked, dir)).toBe(networked.executionFingerprint)
    expect(await currentVerificationFingerprint(isolated, dir)).toBe(isolated.executionFingerprint)
  })
  it.skipIf(!Bun.which('npm'))('does not accept a passing footer from a project npm script-shell override', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsk-verify-script-shell-'))
    dirs.push(dir)
    await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'echo 1 pass' } }))
    const shell = process.platform === 'win32' ? process.env.ComSpec ?? process.env.COMSPEC : '/bin/sh'
    if (!shell) throw new Error('Windows command processor is unavailable')
    await writeFile(join(dir, '.npmrc'), `script-shell=${shell}\n`)
    const command = await detectVerificationCommand(dir)
    expect(command?.display).toBe('npm test')

    const result = await runVerification(command!, dir)

    expect(result.output).toContain('1 pass')
    expect(result.status).toBe('inconclusive')
    expect(result.ok).toBe(false)
    expect(result.testCount).toBeNull()
  })
  it.skipIf(!Bun.which('npm'))('does not accept a passing footer from npm-prepended local runner shims', async () => {
    const dir = await bunProject({})
    await rm(join(dir, 'bun.lock'))
    const localBun = join(dir, 'node_modules', '.bin', process.platform === 'win32' ? 'bun.cmd' : 'bun')
    await mkdir(join(dir, 'node_modules', '.bin'), { recursive: true })
    await writeFakeExecutable(localBun, ['1 pass', '0 fail', 'Ran 1 test across 1 file.'])
    const command = await detectVerificationCommand(dir)

    const result = await runVerification(command!, dir)

    expect(result.output).toContain('Ran 1 test across 1 file.')
    expect(result.status).toBe('inconclusive')
    expect(result.ok).toBe(false)
    expect(result.testCount).toBeNull()
  })
  it('does not accept a test-runner executable replaced through a PATH assignment', async () => {
    const dir = await bunProject({})
    await rm(join(dir, 'bun.lock'))
    const fakeBin = join(dir, 'fakebin')
    await mkdir(fakeBin)
    const fakeBun = join(fakeBin, process.platform === 'win32' ? 'bun.cmd' : 'bun')
    await writeFakeExecutable(fakeBun, ['1 pass'])
    const script = process.platform === 'win32' ? `set "PATH=${fakeBin};%PATH%"&&bun test` : 'PATH=./fakebin bun test'
    await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { test: script } }))

    const result = await runVerification((await detectVerificationCommand(dir))!, dir)

    expect(result.output).toContain('1 pass')
    expect(result.status).toBe('inconclusive')
    expect(result.ok).toBe(false)
    expect(result.testCount).toBeNull()
  })
  it('does not count a passing-looking line printed by a skipped test file', async () => {
    const dir = await bunProject({
      'empty.test.ts': "import { it } from 'bun:test'; console.log('1 pass'); it.skip('not executed', () => {})",
    })

    const result = await runVerification((await detectVerificationCommand(dir))!, dir)

    expect(result.output).toContain('Ran 1 test across 1 file')
    expect(result.status).toBe('empty')
    expect(result.testCount).toBe(0)
    expect(result.ok).toBe(false)
  })
  it('does not trust package lifecycle scripts as the final runner summary', async () => {
    const dir = await bunProject({})
    await rm(join(dir, 'bun.lock'))
    await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: {
      pretest: "printf '1 pass\\n'",
      test: 'bun test --pass-with-no-tests',
      posttest: "printf 'Ran 1 test across 1 file.\\n1 pass\\n0 fail\\n'",
    } }))

    const result = await runVerification((await detectVerificationCommand(dir))!, dir)

    expect(result.status).toBe('inconclusive')
    expect(result.ok).toBe(false)
    expect(result.testCount).toBeNull()
  })
  it('does not accept a failing runner followed by a forged passing summary', async () => {
    const dir = await bunProject({ 'failing.test.ts': "import { it, expect } from 'bun:test'; it('fails', () => expect(1).toBe(2))" })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { test: "bun test ./failing.test.ts || echo '1 pass'" } }))
    const command = await detectVerificationCommand(dir)
    const result = await runVerification(command!, dir)

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('1 pass')
    expect(result.status).toBe('inconclusive')
    expect(result.ok).toBe(false)
    expect(result.testCount).toBeNull()
    expect(isPassedVerificationForWorkspace(result, result.inputDigest ?? '', result.executionFingerprint)).toBe(false)
  })
  it('fails closed when shell expansion can print a forged runner summary', async () => {
    const dir = await bunProject({})
    for (const script of [
      `COUNT="$(printf '1 pass\\n' >&2)" bun test`,
      `bun test "$(printf '1 pass\\n' >&2)"`,
      `bun test <(printf '1 pass\\n')`,
    ]) {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { test: script } }))
      const command = await detectVerificationCommand(dir)
      const result = await runVerification(command!, dir, { execute: async () => ({ exitCode: 0, all: '1 pass\n0 tests ran\n' }) })

      expect(verificationTestCount(result.output)).toBeNull()
      expect(result.status).toBe('inconclusive')
      expect(result.ok).toBe(false)
      expect(result.testCount).toBeNull()
    }
  })
  it('reports a project without tests as empty, never verified', async () => {
    const dir = await bunProject({ 'src/a.ts': 'export const a = 1\n' })
    const command = await detectVerificationCommand(dir)
    expect(command?.display).toBe('bun run test')

    const result = await runVerification(command!, dir)

    expect(result.ok).toBe(false)
    expect(result.status).toBe('empty')
    expect(result.testCount).toBe(0)
    // Bun prints a different message inside AI agents than in a regular terminal.
    expect(result.output).toMatch(/0 test files matching|No tests found!/)
  })

  it('recognizes the no-tests message when the runner prints colors', async () => {
    const dir = await bunProject({ 'src/a.ts': 'export const a = 1\n' })
    const previous = process.env.FORCE_COLOR
    process.env.FORCE_COLOR = '1'
    try {
      const result = await runVerification((await detectVerificationCommand(dir))!, dir)

      expect(result.ok).toBe(false)
      expect(result.status).toBe('empty')
      expect(result.output).not.toContain('\x1b[')
    } finally {
      if (previous === undefined) delete process.env.FORCE_COLOR
      else process.env.FORCE_COLOR = previous
    }
  })

  it('recognizes the no-tests message with Windows line endings', async () => {
    const dir = await bunProject({ 'src/a.ts': 'export const a = 1\n' })
    const command = (await detectVerificationCommand(dir))!
    const result = await runVerification(command, dir, {
      execute: async () => ({ exitCode: 1, all: 'bun test v1.3.13\r\nNo tests found!\r\n' }),
    })

    expect(result.status).toBe('empty')
    expect(result.testCount).toBe(0)
    expect(result.ok).toBe(false)
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

  it('ties a passing suite to unchanged source inputs', async () => {
    const dir = await bunProject({ 'test/a.test.ts': "import { expect, it } from 'bun:test'\nit('passes', () => expect(1).toBe(1))\n" })
    const result = await runVerification((await detectVerificationCommand(dir))!, dir)
    expect(result.ok).toBe(true)
    expect(result.status).toBe('passed')
    expect(result.testCount).toBe(1)
    expect(result.inputDigest).toBe(result.finalDigest)
    expect(result.inputDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(result.executionFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(result.finalExecutionFingerprint).toBe(result.executionFingerprint)
    expect(result.executionEnvironment).toBe('host')
  })

  it('marks a suite stale when package-manager installation metadata changes during the run', async () => {
    const dir = await bunProject({ 'test/a.test.ts': "import { expect, it } from 'bun:test'; it('passes', () => expect(1).toBe(1))" })
    const metadata = join(dir, 'node_modules', '.package-lock.json')
    await mkdir(join(dir, 'node_modules'), { recursive: true })
    await writeFile(metadata, '{"packages":{"fixture":{"version":"1.0.0"}}}')
    const result = await runVerification((await detectVerificationCommand(dir))!, dir, { execute: async () => {
      await writeFile(metadata, '{"packages":{"fixture":{"version":"2.0.0"}}}')
      return { exitCode: 0, all: '1 pass' }
    } })
    expect(result.status).toBe('stale')
    expect(result.inputDigest).toBe(result.finalDigest)
    expect(result.executionFingerprint).not.toBe(result.finalExecutionFingerprint)
  })

  it('marks a suite stale when a declared ignored test input changes during the run', async () => {
    const dir = await bunProject({
      '.gitignore': 'fixtures/ignored.json\n',
      'fixtures/ignored.json': '{"case":"before"}',
      'test/a.test.ts': "import { expect, it } from 'bun:test'; it('passes', () => expect(1).toBe(1))",
    })
    await execa('git', ['init', '-b', 'verification-inputs'], { cwd: dir })
    await writeFile(join(dir, 'package.json'), JSON.stringify({
      scripts: { test: 'bun test' },
      verificationInputs: ['fixtures/ignored.json'],
    }))
    const command = await detectVerificationCommand(dir)
    expect(command?.verificationInputs).toEqual(['fixtures/ignored.json'])

    const result = await runVerification(command!, dir, { execute: async () => {
      await writeFile(join(dir, 'fixtures/ignored.json'), '{"case":"after"}')
      return { exitCode: 0, all: '1 pass' }
    } })

    expect(result.status).toBe('stale')
    expect(result.ok).toBe(false)
    expect(result.inputDigest).toBe(result.finalDigest)
    expect(result.executionFingerprint).not.toBe(result.finalExecutionFingerprint)
  })

  it('rejects sensitive declared inputs and fingerprints explicit generated inputs', async () => {
    const dir = await bunProject({})
    const command = await detectVerificationCommand(dir)
    await expect(captureVerificationFingerprint({ ...command!, verificationInputs: ['.env'] }, dir)).rejects.toThrow('Unsafe declared verification input')
    await mkdir(join(dir, 'dist'), { recursive: true })
    await writeFile(join(dir, 'dist/output.js'), 'export default 1')
    expect(await captureVerificationFingerprint({ ...command!, verificationInputs: ['dist/output.js'] }, dir)).toMatch(/^[a-f0-9]{64}$/)
  })

  it.skipIf(process.platform === 'win32')('rejects symlinked parent aliases into sensitive and excluded paths', async () => {
    const dir = await bunProject({ '.aws/config': 'synthetic credential fixture', 'node_modules/fixture/input.json': 'generated dependency fixture' })
    const command = await detectVerificationCommand(dir)
    await symlink(join(dir, '.aws'), join(dir, 'sensitive-alias'))
    await symlink(join(dir, 'node_modules', 'fixture'), join(dir, 'dependency-alias'))

    await expect(captureVerificationFingerprint({ ...command!, verificationInputs: ['sensitive-alias/config'] }, dir)).rejects.toThrow('Unsafe declared verification input')
    await expect(captureVerificationFingerprint({ ...command!, verificationInputs: ['dependency-alias/input.json'] }, dir)).rejects.toThrow('Excluded verification input')
  })

  it('rejects sparse declared inputs over the byte budget before hashing', async () => {
    const dir = await bunProject({ 'fixtures/sparse.bin': '' })
    const path = join(dir, 'fixtures', 'sparse.bin')
    await truncate(path, 256 * 1024 * 1024 + 1)
    const command = await detectVerificationCommand(dir)

    await expect(captureVerificationFingerprint({ ...command!, verificationInputs: ['fixtures/sparse.bin'] }, dir)).rejects.toThrow('Declared verification inputs exceed 256 MiB')
  })

  it('marks nested-package verification stale when a workspace-root dependency changes', async () => {
    const dir = await bunProject({
      '.gitignore': 'node_modules/\n.yarn/install-state.gz\n',
      'packages/app/package.json': JSON.stringify({ scripts: { test: 'bun test ./selected.test.ts' } }),
      'packages/app/bun.lock': '',
      'packages/app/selected.test.ts': "import { expect, it } from 'bun:test'; it('passes', () => expect(1).toBe(1))",
    })
    await execa('git', ['init', '-b', 'verification-workspace'], { cwd: dir })
    const dependency = join(dir, 'node_modules', 'workspace-package', 'index.js')
    await mkdir(join(dependency, '..'), { recursive: true })
    await writeFile(dependency, 'export const version = 1')
    const packageCwd = join(dir, 'packages', 'app')
    const command = await detectVerificationCommand(packageCwd)

    const result = await runVerification(command!, packageCwd, { execute: async () => {
      await writeFile(dependency, 'export const version = 2')
      return { exitCode: 0, all: '1 pass' }
    } })

    expect(result.status).toBe('stale')
    expect(result.inputDigest).toBe(result.finalDigest)
    expect(result.executionFingerprint).not.toBe(result.finalExecutionFingerprint)

    const installState = join(dir, '.yarn', 'install-state.gz')
    await mkdir(join(dir, '.yarn'), { recursive: true })
    await writeFile(installState, 'install state v1')
    const metadataResult = await runVerification(command!, packageCwd, { execute: async () => {
      await writeFile(installState, 'install state v2')
      return { exitCode: 0, all: '1 pass' }
    } })
    expect(metadataResult.status).toBe('stale')
    expect(metadataResult.inputDigest).toBe(metadataResult.finalDigest)
    expect(metadataResult.executionFingerprint).not.toBe(metadataResult.finalExecutionFingerprint)
  })

  it('binds installed package bytes and refuses dependency symlinks outside the project', async () => {
    const dir = await bunProject({})
    const installed = join(dir, 'node_modules', 'fixture-package', 'index.js')
    await mkdir(join(dir, 'node_modules', 'fixture-package'), { recursive: true })
    await writeFile(installed, 'export const value = 1\n')
    const command = (await detectVerificationCommand(dir))!
    const before = await captureVerificationFingerprint(command, dir)
    await writeFile(installed, 'export const value = 2\n')
    const after = await captureVerificationFingerprint(command, dir)
    expect(after).not.toBe(before)

    const outside = await mkdtemp(join(tmpdir(), 'dsk-verify-outside-dependency-'))
    dirs.push(outside)
    await writeFile(join(outside, 'index.js'), 'outside dependency')
    await symlink(outside, join(dir, 'node_modules', 'external-package'))
    await expect(captureVerificationFingerprint(command, dir)).rejects.toThrow('escapes the project')
  })

  it('marks verification stale when an installed package file changes while tests run', async () => {
    const dir = await bunProject({})
    const installed = join(dir, 'node_modules', 'fixture-package', 'index.js')
    await mkdir(join(dir, 'node_modules', 'fixture-package'), { recursive: true })
    await writeFile(installed, 'export const value = 1\n')
    const result = await runVerification((await detectVerificationCommand(dir))!, dir, { execute: async () => {
      await writeFile(installed, 'export const value = 2\n')
      return { exitCode: 0, all: '1 pass' }
    } })
    expect(result.status).toBe('stale')
    expect(result.inputDigest).toBe(result.finalDigest)
    expect(result.executionFingerprint).not.toBe(result.finalExecutionFingerprint)
  })

  it('hashes effective environment values and the selected test-runner executable without storing raw values', async () => {
    const dir = await bunProject({})
    const environment = { PATH: process.env.PATH, HOME: 'verification-home-canary' }
    const command = { command: process.execPath, args: ['--version'], display: 'runtime --version' }
    const first = await captureVerificationFingerprint(command, dir, { environment })
    environment.HOME = 'different-verification-home'
    const second = await captureVerificationFingerprint(command, dir, { environment })
    expect(first).not.toBe(second)
    expect(first).not.toContain('verification-home-canary')
    expect(first).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects a green suite that changes source inputs', async () => {
    const dir = await bunProject({ 'src/a.ts': 'before', 'test/a.test.ts': "import { it } from 'bun:test'\nimport { writeFileSync } from 'node:fs'\nit('changes source', () => writeFileSync('src/a.ts', 'after'))\n" })
    const result = await runVerification((await detectVerificationCommand(dir))!, dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe('stale')
    expect(result.inputDigest).not.toBe(result.finalDigest)
  })

  it('rejects exit-zero empty suites', async () => {
    const dir = await bunProject({})
    const result = await runVerification({ command: 'bun', args: ['-e', "console.log('0 passed')"], display: 'empty runner' }, dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe('inconclusive')
    expect(result.testCount).toBeNull()
  })

  it('distinguishes timeout and cancellation from test failures', async () => {
    const dir = await bunProject({})
    const command = { command: 'bun', args: ['-e', 'await Bun.sleep(10000)'], display: 'slow runner' }
    expect((await runVerification(command, dir, { timeoutMs: 20 })).status).toBe('timed_out')
    expect((await runVerification(command, dir, { signal: AbortSignal.abort() })).status).toBe('cancelled')
  })
})

it('runs the configured Bun script but does not certify a chained runner', async () => {
  const dir = await bunProject({
    'selected.test.ts': "import { it, expect } from 'bun:test'; it('selected contract', () => expect(2 + 2).toBe(4))",
    'excluded.test.ts': "import { it, expect } from 'bun:test'; it('excluded default-scan trap', () => expect(1).toBe(2))",
  })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { test: `bun -e 'console.log("configured setup ran")' && bun test ./selected.test.ts` } }))
  const command = await detectVerificationCommand(dir)
  const result = await runVerification(command!, dir)
  expect(result.status).toBe('inconclusive')
  expect(command).toEqual({ command: 'bun', args: ['run', 'test'], display: 'bun run test' })
  expect(result.testCount).toBeNull()
  expect(result.output).toContain('configured setup ran')
  expect(result.output).not.toContain('excluded default-scan trap')
})

it('does not invent a test command for empty package scripts', async () => {
  const dir = await bunProject({})
  for (const test of ['', '   ', 7, null]) {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { test } }))
    expect(await detectVerificationCommand(dir)).toBeNull()
  }
})

it('preserves package-manager and native-project selection while supporting both Bun lockfile formats', async () => {
  for (const [lock, command] of [
    ['bun.lock', { command: 'bun', args: ['run', 'test'], display: 'bun run test' }],
    ['bun.lockb', { command: 'bun', args: ['run', 'test'], display: 'bun run test' }],
    ['pnpm-lock.yaml', { command: 'pnpm', args: ['test'], display: 'pnpm test' }],
    ['yarn.lock', { command: 'yarn', args: ['test'], display: 'yarn test' }],
    [null, { command: 'npm', args: ['test'], display: 'npm test' }],
  ] as const) {
    const dir = await bunProject({})
    await rm(join(dir, 'bun.lock'))
    if (lock) await writeFile(join(dir, lock), '')
    expect(await detectVerificationCommand(dir)).toEqual({ ...command, args: [...command.args] })
  }
  const dir = await bunProject({})
  await rm(join(dir, 'package.json'))
  await writeFile(join(dir, 'Cargo.toml'), '')
  expect(await detectVerificationCommand(dir)).toEqual({ command: 'cargo', args: ['test'], display: 'cargo test' })
  await rm(join(dir, 'Cargo.toml'))
  await writeFile(join(dir, 'go.mod'), '')
  expect(await detectVerificationCommand(dir)).toEqual({ command: 'go', args: ['test', '-json', './...'], display: 'go test -json ./...' })
})

it.skipIf(process.platform === 'win32')('does not count a project venv wrapper as pytest evidence', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'dsk-verify-python-'))
  dirs.push(parent)
  const dir = join(parent, 'project with spaces')
  await mkdir(dir)
  await writeFile(join(dir, 'pytest.ini'), '[pytest]\ntestpaths = tests\n')
  const makePython = async (venv: string, output: string) => {
    const executable = join(dir, venv, 'bin', 'python')
    await mkdir(join(dir, venv, 'bin'), { recursive: true })
    await writeFile(executable, `#!/bin/sh\n[ "$1" = "-I" ] && [ "$2" = "-m" ] && [ "$3" = "pytest" ] || exit 22\nprintf '%s\\n' ${JSON.stringify(output)}\n`)
    await chmod(executable, 0o755)
    return executable
  }
  const projectPython = await makePython('.venv', '1 passed from project venv')
  await makePython('venv', '0 passed from competing venv')

  const command = await detectVerificationCommand(dir)
  expect(command).toEqual({
    command: projectPython,
    args: ['-I', '-m', 'pytest'],
    display: `'${projectPython}' -I -m pytest`,
  })
  const result = await runVerification(command!, dir)
  expect(result.status).toBe('inconclusive')
  expect(result.testCount).toBeNull()
  expect(result.output).toContain('1 passed from project venv')
  expect(result.output).not.toContain('competing venv')
})

it('only selects a local Python interpreter for configured pytest projects', async () => {
  const configured = await mkdtemp(join(tmpdir(), 'dsk-verify-python-config-'))
  dirs.push(configured)
  await writeFile(join(configured, 'pytest.ini'), '[pytest]\n')
  expect(await detectVerificationCommand(configured)).toBeNull()

  const unconfigured = await mkdtemp(join(tmpdir(), 'dsk-verify-python-no-config-'))
  dirs.push(unconfigured)
  const interpreter = join(unconfigured, '.venv', 'bin', 'python')
  await mkdir(join(unconfigured, '.venv', 'bin'), { recursive: true })
  await writeFile(interpreter, '#!/bin/sh\nexit 0\n')
  await chmod(interpreter, 0o755)
  expect(await detectVerificationCommand(unconfigured)).toBeNull()
})

it('recognizes the conventional pytest configuration files', async () => {
  for (const [file, content] of [
    ['pyproject.toml', '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n'],
    ['setup.cfg', '[tool:pytest]\ntestpaths = tests\n'],
    ['tox.ini', '[testenv]\ncommands = python -m pytest\n'],
  ]) {
    const dir = await mkdtemp(join(tmpdir(), 'dsk-verify-python-config-'))
    dirs.push(dir)
    await writeFile(join(dir, file), content)
    const pythonDirectory = process.platform === 'win32' ? join(dir, '.venv', 'Scripts') : join(dir, '.venv', 'bin')
    const executable = join(pythonDirectory, process.platform === 'win32' ? 'python.exe' : 'python')
    await mkdir(pythonDirectory, { recursive: true })
    await writeFile(executable, process.platform === 'win32' ? '' : '#!/bin/sh\nexit 0\n')
    await chmod(executable, 0o755)
    expect((await detectVerificationCommand(dir))?.command).toBe(executable)
  }
})

it.skipIf(process.platform === 'win32')('does not let pytest test output override a terminal skipped-only summary', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsk-verify-pytest-skipped-'))
  dirs.push(dir)
  await writeFile(join(dir, 'pytest.ini'), '[pytest]\naddopts = -s\n')
  const executable = join(dir, '.venv', 'bin', 'python')
  await mkdir(join(dir, '.venv', 'bin'), { recursive: true })
  await writeFile(executable, '#!/bin/sh\nprintf "1 passed\\n1 skipped in 0.01s\\n"\n')
  await chmod(executable, 0o755)

  const command = await detectVerificationCommand(dir)
  const result = await runVerification(command!, dir)

  expect(result.status).toBe('inconclusive')
  expect(result.testCount).toBeNull()
  expect(result.ok).toBe(false)
})

it('retains checkout provenance and refuses a passing receipt from an identical clone', async () => {
  const dir = await bunProject({ 'contract.test.ts': "import { it, expect } from 'bun:test'; it('contract', () => expect(1).toBe(1))" })
  const git = (cwd: string, args: string[]) => execa('git', args, { cwd })
  await git(dir, ['init', '-b', 'receipt-main'])
  await git(dir, ['config', 'user.name', 'Receipt Test'])
  await git(dir, ['config', 'user.email', 'receipt-test@example.invalid'])
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-m', 'fixture'])
  const clone = await mkdtemp(join(tmpdir(), 'dsk-verify-clone-'))
  dirs.push(clone)
  await git(dir, ['clone', '--local', dir, clone])
  const receipt = await runVerification((await detectVerificationCommand(dir))!, dir)
  const original = await captureWorkspaceVersion(dir)
  const other = await captureWorkspaceVersion(clone)
  expect(receipt.status).toBe('passed')
  expect(receipt.inputWorkspace).toEqual(original)
  expect(receipt.finalWorkspace).toEqual(original)
  expect(receipt.inputWorkspace?.branch).toBe('receipt-main')
  expect(other.head).toBe(original.head)
  expect(other.fileCount).toBe(original.fileCount)
  expect(isPassedVerificationForWorkspace(receipt, original.digest, receipt.executionFingerprint)).toBe(true)
  expect(isPassedVerificationForWorkspace(receipt, other.digest, receipt.executionFingerprint)).toBe(false)
  expect(isPassedVerificationForWorkspace(receipt, original.digest, 'f'.repeat(64))).toBe(false)

  const changed = await runVerification((await detectVerificationCommand(dir))!, dir, { execute: async () => {
    await git(dir, ['checkout', '-b', 'receipt-other'])
    return { exitCode: 0, all: '1 pass' }
  } })
  expect(changed.status).toBe('stale')
  expect(changed.ok).toBe(false)
  expect(changed.inputWorkspace?.head).toBe(changed.finalWorkspace?.head)
  expect(changed.inputWorkspace?.branch).toBe('receipt-main')
  expect(changed.finalWorkspace?.branch).toBe('receipt-other')
})
