import { afterEach, expect, it } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runVerification } from '../src/agent/verify.js'

const directories: string[] = []

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

it('rejects a passing suite when an explicitly declared dist artifact changes during verification', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dsk-verify-dist-'))
  directories.push(project)
  await mkdir(join(project, 'dist'), { recursive: true })
  const artifact = join(project, 'dist', 'output.js')
  await writeFile(artifact, 'export const output = 1\n')

  const result = await runVerification({
    command: 'bun',
    args: ['test'],
    display: 'bun test',
    verificationInputs: ['dist/output.js'],
  }, project, { execute: async () => {
    await writeFile(artifact, 'export const output = 200\n')
    return { exitCode: 0, all: '1 pass' }
  } })

  expect(result.status).toBe('stale')
  expect(result.ok).toBe(false)
  expect(result.inputDigest).toBe(result.finalDigest)
  expect(result.executionFingerprint).not.toBe(result.finalExecutionFingerprint)
})
