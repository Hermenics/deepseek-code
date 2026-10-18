import { afterEach, expect, it } from 'bun:test'
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectVerificationCommand, runVerification } from '../src/agent/verify.js'
import { verificationTestCount, verificationTestFailureCount } from '../src/agent/verificationTestCount.js'

const directories: string[] = []
const systemPython = Bun.which('python3') ?? Bun.which('python')

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

it('uses only the selected runner summary for execution counts', () => {
  const output = '1 pass\n1 fail\nRan 2 tests across 1 file.\n1 passed'

  expect(verificationTestCount(output, 'bun')).toBe(2)
  expect(verificationTestFailureCount(output, 'bun')).toBe(1)

  const mixedRunnerOutput = '1 pass\n0 fail\nRan 1 test across 1 file.\n=== 1 failed, 1 passed in 0.02s ==='
  expect(verificationTestCount(mixedRunnerOutput, 'pytest')).toBe(2)
  expect(verificationTestFailureCount(mixedRunnerOutput, 'pytest')).toBe(1)
})

it.skipIf(process.platform === 'win32')('does not accept a shebang wrapper as a native pytest executable', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dsk-verify-python-identity-'))
  directories.push(project)
  await writeFile(join(project, 'pytest.ini'), '[pytest]\ntestpaths = tests\n')

  const interpreter = join(project, '.venv', 'bin', 'python')
  await mkdir(join(project, '.venv', 'bin'), { recursive: true })
  await writeFile(interpreter, '#!/bin/sh\nprintf "1 passed\\n"\n')
  await chmod(interpreter, 0o755)

  const command = await detectVerificationCommand(project)
  expect(command?.command).toBe(interpreter)
  expect(command?.args).toEqual(['-I', '-m', 'pytest'])

  const result = await runVerification(command!, project)

  expect(result.output).toContain('1 passed')
  expect(result.status).toBe('inconclusive')
  expect(result.testCount).toBeNull()
  expect(result.ok).toBe(false)
})

it.skipIf(process.platform === 'win32' || !systemPython)('does not let a project-local pytest.py forge a passing receipt', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dsk-verify-python-shadow-'))
  directories.push(project)
  await writeFile(join(project, 'pytest.py'), "print('1 passed from local pytest.py')\n")

  const result = await runVerification({
    command: systemPython!,
    args: ['-I', '-m', 'pytest'],
    display: `'${systemPython}' -I -m pytest`,
  }, project)

  expect(result.output).not.toContain('1 passed from local pytest.py')
  expect(result.exitCode).not.toBe(0)
  expect(result.status).toBe('failed')
  expect(result.testCount).toBeNull()
  expect(result.ok).toBe(false)
})

it('does not issue a passing receipt when Bun reports failures with exit code zero', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dsk-verify-bun-failure-summary-'))
  directories.push(project)

  const result = await runVerification({
    command: process.execPath,
    args: ['test'],
    display: 'bun test',
  }, project, {
    execute: async () => ({ exitCode: 0, all: '1 pass\n1 fail\nRan 2 tests across 1 file.' }),
  })

  expect(result.status).toBe('failed')
  expect(result.testCount).toBe(2)
  expect(result.ok).toBe(false)
})

it('does not let a later pytest-shaped footer erase Bun failures', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dsk-verify-bun-forged-footer-'))
  directories.push(project)

  for (const footer of ['=== 2 passed ===', '=== 2 passed in 0.01s ===', '=== 2 passed, 0 failed in 0.01s ===']) {
    const result = await runVerification({
      command: process.execPath,
      args: ['test'],
      display: 'bun test',
    }, project, {
      execute: async () => ({ exitCode: 0, all: `1 pass\n1 fail\nRan 2 tests across 1 file.\n${footer}` }),
    })

    expect(result.status).toBe('failed')
    expect(result.testCount).toBe(2)
    expect(result.ok).toBe(false)
  }
})

it.skipIf(process.platform === 'win32' || !systemPython)('does not issue a passing receipt when pytest reports failures with exit code zero', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dsk-verify-pytest-failure-summary-'))
  directories.push(project)

  const result = await runVerification({
    command: systemPython!,
    args: ['-I', '-m', 'pytest'],
    display: `'${systemPython}' -I -m pytest`,
  }, project, {
    execute: async () => ({
      exitCode: 0,
      all: '========================= short test summary info =========================\nFAILED tests/test_example.py::test_failure - AssertionError\n======================== 1 failed, 1 passed in 0.02s =======================',
    }),
  })

  expect(result.status).toBe('failed')
  expect(result.testCount).toBe(2)
  expect(result.ok).toBe(false)
})

it.skipIf(process.platform === 'win32' || !systemPython)('uses the last runner summary when Bun output precedes a failing pytest summary', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dsk-verify-mixed-runner-summaries-'))
  directories.push(project)

  const result = await runVerification({
    command: systemPython!,
    args: ['-I', '-m', 'pytest'],
    display: `'${systemPython}' -I -m pytest`,
  }, project, {
    execute: async () => ({
      exitCode: 0,
      all: '1 pass\n0 fail\nRan 1 test across 1 file.\n=== 1 failed, 1 passed in 0.02s ===',
    }),
  })

  expect(result.status).toBe('failed')
  expect(result.testCount).toBe(2)
  expect(result.ok).toBe(false)
})
