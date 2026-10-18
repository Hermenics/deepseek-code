import { expect, it } from 'bun:test'
import { lstat, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { Git } from '../src/tools/Git/Git.js'
import { scrubbedEnv } from '../src/utils/platform.js'

for (const helperKind of ['external', 'textconv', 'fsmonitor'] as const) {
  it.skipIf(process.platform === 'win32')(`reads Git data without executing its configured ${helperKind} helper`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-git-inspection-'))
    const marker = join(root, '.git', 'helper-started')
    const git = (args: string[]) => execa('git', args, { cwd: root, env: scrubbedEnv(), extendEnv: false })
    try {
      await git(['init', '-b', 'inspection-main'])
      await git(['config', 'user.name', 'Inspection Test'])
      await git(['config', 'user.email', 'inspection@example.invalid'])
      await writeFile(join(root, 'source.txt'), 'before\n')
      await writeFile(join(root, '.gitattributes'), '*.txt diff=fixture\n')
      await git(['add', '.'])
      await git(['commit', '-m', 'fixture'])
      await writeFile(join(root, 'source.txt'), 'after\n')
      const helper = join(root, '.git', 'inspection-helper')
      await writeFile(helper, `#!${process.execPath}\nawait Bun.write(${JSON.stringify(marker)}, 'helper executed'); process.stdout.write('fixture helper\\n')\n`, { mode: 0o700 })
      const key = helperKind === 'external' ? 'diff.external' : helperKind === 'textconv' ? 'diff.fixture.textconv' : 'core.fsmonitor'
      await git(['config', key, helper])
      // Confirm that the fixture actually invokes the helper without the inspection protections.
      await git([helperKind === 'fsmonitor' ? 'status' : 'diff'])
      expect((await lstat(marker)).isFile()).toBe(true)
      await rm(marker)
      const result = await Git.execute({ action: helperKind === 'fsmonitor' ? 'status' : 'diff' }, { sessionId: 'inspection-fixture', workspacePath: root, projectRoot: root, permissionProfile: 'coordinator-integrator' as const })
      expect(result).toContain('source.txt')
      if (helperKind !== 'fsmonitor') {
        expect(result).toContain('-before')
        expect(result).toContain('+after')
      }
      await expect(lstat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { await rm(root, { recursive: true, force: true }) }
  })
}


it('reports failed Git inspections in one typed batch error with each operation result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-git-not-repo-'))
  const context = { sessionId: 'inspection-fixture', workspacePath: root, projectRoot: root, permissionProfile: 'coordinator-integrator' as const }
  try {
    for (const action of ['status', 'diff', 'log', 'branch']) {
      expect(JSON.parse(await Git.execute({ action }, context))).toMatchObject({
        schemaVersion: 1,
        status: 'error',
        error: { kind: 'tool', code: 'GIT_OPERATION_FAILED', retryable: false },
      })
    }
    const result = JSON.parse(await Git.execute({ action: 'batch', operations: [{ action: 'status' }, { action: 'diff' }, { action: 'log' }] }, context))
    expect(result).toMatchObject({
      schemaVersion: 1,
      status: 'error',
      error: { kind: 'tool', code: 'GIT_BATCH_FAILED', retryable: false },
      partial: { results: [
        { index: 1, action: 'status', status: 'error', result: { status: 'error', error: { code: 'GIT_OPERATION_FAILED' } } },
        { index: 2, action: 'diff', status: 'error', result: { status: 'error', error: { code: 'GIT_OPERATION_FAILED' } } },
        { index: 3, action: 'log', status: 'error', result: { status: 'error', error: { code: 'GIT_OPERATION_FAILED' } } },
      ] },
    })
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('preserves successful Git batch formatting and reports mixed child outcomes in a typed partial result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-git-batch-mixed-'))
  const run = (args: string[]) => execa('git', args, { cwd: root, env: scrubbedEnv(), extendEnv: false })
  const context = { sessionId: 'inspection-fixture', workspacePath: root, projectRoot: root, permissionProfile: 'coordinator-integrator' as const }
  try {
    await run(['init', '-b', 'main'])
    await run(['config', 'user.name', 'Inspection Test'])
    await run(['config', 'user.email', 'inspection@example.invalid'])
    await writeFile(join(root, 'source.txt'), 'fixture\n')
    await run(['add', 'source.txt'])
    await run(['commit', '-m', 'initial fixture'])

    const operations = [{ action: 'status' }, { action: 'diff' }, { action: 'log' }]
    const expected = await Promise.all(operations.map(async operation => {
      const result = await Git.execute(operation, context)
      const label = operation.action === 'log' ? 'log (n=20)' : operation.action
      return `### ${label}\n${result}`
    }))
    expect(await Git.execute({ action: 'batch', operations }, context)).toBe(expected.join('\n\n'))

    const mixed = JSON.parse(await Git.execute({
      action: 'batch',
      operations: [{ action: 'status' }, { action: 'log', n: -1 }, { action: 'diff' }],
    }, context))
    expect(mixed).toMatchObject({
      schemaVersion: 1,
      status: 'partial',
      error: { kind: 'tool', code: 'GIT_BATCH_PARTIAL', retryable: false },
      partial: { results: [
        { index: 1, action: 'status', status: 'done', output: expect.stringContaining('## main') },
        { index: 2, action: 'log', label: 'log (n=-1)', status: 'error', result: { status: 'error', error: { code: 'GIT_OPERATION_FAILED' } } },
        { index: 3, action: 'diff', status: 'done', output: 'No changes' },
      ] },
    })
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('returns invalid Git actions as typed validation errors', async () => {
  const result = JSON.parse(await Git.execute({ action: 'unknown' }, {
    sessionId: 'inspection-fixture', workspacePath: process.cwd(), projectRoot: process.cwd(),
    permissionProfile: 'coordinator-integrator' as const,
  }))
  expect(result).toMatchObject({ status: 'error', error: { kind: 'validation', code: 'INVALID_ARGUMENTS' } })
})

it('reports the effective default and explicit commit limits for Git log', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-git-log-limit-'))
  const run = (args: string[]) => execa('git', args, { cwd: root, env: scrubbedEnv(), extendEnv: false })
  const context = { sessionId: 'inspection-fixture', workspacePath: root, projectRoot: root, permissionProfile: 'coordinator-integrator' as const }
  try {
    await run(['init', '-b', 'main'])
    await run(['config', 'user.name', 'Inspection Test'])
    await run(['config', 'user.email', 'inspection@example.invalid'])
    await writeFile(join(root, 'source.txt'), 'fixture\n')
    await run(['add', 'source.txt'])
    await run(['commit', '-m', 'initial fixture'])

    const defaultResult = await Git.execute({ action: 'log' }, context)
    expect(defaultResult).toStartWith('Log limit: 20\n')
    expect(defaultResult).toContain('initial fixture')
    const explicitResult = await Git.execute({ action: 'log', n: 1 }, context)
    expect(explicitResult).toStartWith('Log limit: 1\n')
    const batchResult = await Git.execute({ action: 'batch', operations: [{ action: 'log' }] }, context)
    expect(batchResult).toContain('### log (n=20)\nLog limit: 20\n')
  } finally { await rm(root, { recursive: true, force: true }) }
})
