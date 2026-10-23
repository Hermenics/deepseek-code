import { expect, it } from 'bun:test'
import { lstat, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { Git } from '../src/tools/Git/Git.js'
import { scrubbedEnv } from '../src/utils/platform.js'

async function repository(root: string) {
  await mkdir(root)
  await execa('git', ['init', '-b', 'mutation-fixture'], { cwd: root })
  await execa('git', ['config', 'user.name', 'Mutation Test'], { cwd: root })
  await execa('git', ['config', 'user.email', 'mutation@example.invalid'], { cwd: root })
  await writeFile(join(root, 'source.txt'), 'original\n')
  await execa('git', ['add', '.'], { cwd: root })
  await execa('git', ['commit', '-m', 'fixture'], { cwd: root })
}
const context = (root: string) => ({ sessionId: 'mutation-fixture', workspacePath: root, projectRoot: root, permissionProfile: 'coordinator-integrator' as const })
const effectContext = (root: string, outcomes: Array<{ effectId: string; state: 'no-effect' | 'effect-observed'; evidence: string }>) => ({
  ...context(root), effectId: 'git-effect-1',
  markEffectOutcome: async (effectId: string, state: 'no-effect' | 'effect-observed', evidence: string) => { outcomes.push({ effectId, state, evidence }) },
})

it('stages only the selected repository despite inherited Git overrides', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'deepseek-git-mutation-env-'))
  const root = join(parent, 'selected')
  const other = join(parent, 'unrelated')
  const previousDir = process.env.GIT_DIR
  const previousTree = process.env.GIT_WORK_TREE
  try {
    await repository(root)
    await repository(other)
    await writeFile(join(root, 'source.txt'), 'selected change\n')
    await writeFile(join(other, 'source.txt'), 'unrelated change\n')
    process.env.GIT_DIR = join(other, '.git')
    process.env.GIT_WORK_TREE = other
    expect(await Git.execute({ action: 'add', files: ['source.txt'] }, context(root))).toContain('Staged:')
    const indexed = (cwd: string) => execa('git', ['show', ':source.txt'], { cwd, env: scrubbedEnv(), extendEnv: false })
    expect((await indexed(root)).stdout).toBe('selected change')
    expect((await indexed(other)).stdout).toBe('original')
  } finally {
    if (previousDir === undefined) delete process.env.GIT_DIR
    else process.env.GIT_DIR = previousDir
    if (previousTree === undefined) delete process.env.GIT_WORK_TREE
    else process.env.GIT_WORK_TREE = previousTree
    await rm(parent, { recursive: true, force: true })
  }
})

it('records a failed add as no-effect when the local Git snapshot is unchanged', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'deepseek-git-partial-add-'))
  const root = join(parent, 'repo')
  try {
    await repository(root)
    await writeFile(join(root, 'source.txt'), 'partially staged change\n')
    const outcomes: Array<{ effectId: string; state: 'no-effect' | 'effect-observed'; evidence: string }> = []
    const result = JSON.parse(await Git.execute({ action: 'add', files: ['source.txt', 'missing.txt'] }, effectContext(root, outcomes)))
    expect(result).toMatchObject({
      status: 'partial',
      error: { kind: 'conflict', code: 'GIT_LOCAL_EFFECT_NOT_APPLIED', retryable: false },
      partial: { effectResolution: 'no-effect' },
    })
    expect(result.partial.effectEvidence).toMatch(/^no-effect:[0-9a-f]{64}$/)
    expect(outcomes).toEqual([{ effectId: 'git-effect-1', state: 'no-effect', evidence: result.partial.effectEvidence }])
    expect((await execa('git', ['show', ':source.txt'], { cwd: root, env: scrubbedEnv(), extendEnv: false })).stdout)
      .toBe('original')
  } finally { await rm(parent, { recursive: true, force: true }) }
})

it('records a successful add as effect-observed without changing its result', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'deepseek-git-successful-add-'))
  const root = join(parent, 'repo')
  try {
    await repository(root)
    await writeFile(join(root, 'source.txt'), 'staged change\n')
    const outcomes: Array<{ effectId: string; state: 'no-effect' | 'effect-observed'; evidence: string }> = []
    const result = await Git.execute({ action: 'add', files: ['source.txt'] }, effectContext(root, outcomes))
    expect(result).toMatch(/^Staged: source\.txt/)
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({ effectId: 'git-effect-1', state: 'effect-observed' })
    expect(outcomes[0]!.evidence).toMatch(/^effect-observed:[0-9a-f]{64}$/)
    expect((await execa('git', ['show', ':source.txt'], { cwd: root, env: scrubbedEnv(), extendEnv: false })).stdout)
      .toBe('staged change')
  } finally { await rm(parent, { recursive: true, force: true }) }
})

it('records a successful no-op add as no-effect without changing its result', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'deepseek-git-noop-add-'))
  const root = join(parent, 'repo')
  try {
    await repository(root)
    const outcomes: Array<{ effectId: string; state: 'no-effect' | 'effect-observed'; evidence: string }> = []
    const result = await Git.execute({ action: 'add', files: ['source.txt'] }, effectContext(root, outcomes))
    expect(result).toMatch(/^Staged: source\.txt/)
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({ effectId: 'git-effect-1', state: 'no-effect' })
    expect(outcomes[0]!.evidence).toMatch(/^no-effect:[0-9a-f]{64}$/)
  } finally { await rm(parent, { recursive: true, force: true }) }
})

it('preserves a successful add when outcome persistence fails', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'deepseek-git-outcome-checkpoint-failure-'))
  const root = join(parent, 'repo')
  try {
    await repository(root)
    await writeFile(join(root, 'source.txt'), 'staged change\n')
    let outcomeAttempts = 0
    const result = await Git.execute({ action: 'add', files: ['source.txt'] }, {
      ...context(root),
      effectId: 'git-effect-1',
      markEffectOutcome: async () => { outcomeAttempts++; throw new Error('snapshot store unavailable') },
    })
    expect(result).toMatch(/^Staged: source\.txt/)
    expect(outcomeAttempts).toBe(1)
  } finally { await rm(parent, { recursive: true, force: true }) }
})

for (const action of ['commit', 'branch'] as const) {
  it.skipIf(process.platform === 'win32')(`performs local ${action} without invoking native Git hooks`, async () => {
    const parent = await mkdtemp(join(tmpdir(), 'deepseek-git-native-hook-'))
    const root = join(parent, 'repo')
    try {
      await repository(root)
      const marker = join(root, '.git', 'hook-started')
      const hook = action === 'commit' ? 'pre-commit' : 'post-checkout'
      await writeFile(join(root, '.git', 'hooks', hook), `#!${process.execPath}\nawait Bun.write(${JSON.stringify(marker)}, 'executed')\n`, { mode: 0o700 })
      await writeFile(join(root, 'source.txt'), 'local change\n')
      expect(await Git.execute({ action: 'add', files: ['source.txt'] }, context(root))).toContain('Staged:')
      const result = await Git.execute(action === 'commit' ? { action, message: 'Local fixture change' } : { action, create: 'local-change' }, context(root))
      expect(result).not.toMatch(/^Error:/)
      await expect(lstat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readFile(join(root, 'source.txt'), 'utf8')).toBe('local change\n')
    } finally { await rm(parent, { recursive: true, force: true }) }
  })
}

it.skipIf(process.platform === 'win32')('preserves the staged change when automatic signing requires an external helper', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'deepseek-git-signing-'))
  const root = join(parent, 'repo')
  try {
    await repository(root)
    const git = (args: string[]) => execa('git', args, { cwd: root, env: scrubbedEnv(), extendEnv: false })
    const before = (await git(['rev-parse', 'HEAD'])).stdout
    const marker = join(root, '.git', 'signer-started')
    const helper = join(root, '.git', 'signing-helper')
    await writeFile(helper, `#!${process.execPath}\nawait Bun.write(${JSON.stringify(marker)}, 'executed')\n`, { mode: 0o700 })
    await git(['config', 'commit.gpgsign', 'true'])
    await git(['config', 'gpg.program', helper])
    await writeFile(join(root, 'source.txt'), 'pending signed change\n')
    await Git.execute({ action: 'add', files: ['source.txt'] }, context(root))
    expect(await Git.execute({ action: 'commit', message: 'Requires signing' }, context(root))).toContain('signing program')
    await expect(lstat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await git(['rev-parse', 'HEAD'])).stdout).toBe(before)
    expect((await git(['show', ':source.txt'])).stdout).toBe('pending signed change')
  } finally { await rm(parent, { recursive: true, force: true }) }
})

for (const selectedBy of ['attribute', 'default'] as const) {
  it.skipIf(process.platform === 'win32')(`keeps conflicting stash work without executing a ${selectedBy} merge driver`, async () => {
    const parent = await mkdtemp(join(tmpdir(), 'deepseek-git-merge-driver-'))
    const root = join(parent, 'repo')
    try {
      await repository(root)
      const git = (args: string[]) => execa('git', args, { cwd: root, env: scrubbedEnv(), extendEnv: false })
      if (selectedBy === 'attribute') {
        await writeFile(join(root, '.gitattributes'), '*.txt merge=Fixture.Merge\n')
        await git(['add', '.gitattributes'])
        await git(['commit', '-m', 'merge attributes'])
      }
      await writeFile(join(root, 'source.txt'), 'stashed version\n')
      await git(['stash', 'push', '-m', 'must preserve'])
      const stash = (await git(['rev-parse', 'refs/stash'])).stdout
      await writeFile(join(root, 'source.txt'), 'committed version\n')
      await git(['add', 'source.txt'])
      await git(['commit', '-m', 'conflicting change'])
      const marker = join(root, '.git', 'merge-helper-started')
      const helper = join(root, '.git', 'merge-helper')
      await writeFile(helper, `#!${process.execPath}\nawait Bun.write(${JSON.stringify(marker)}, 'executed')\n`, { mode: 0o700 })
      await git(['config', 'merge.Fixture.Merge.driver', helper])
      if (selectedBy === 'default') await git(['config', 'merge.default', 'Fixture.Merge'])
      const outcomes: Array<{ effectId: string; state: 'no-effect' | 'effect-observed'; evidence: string }> = []
      const result = await Git.execute({ action: 'stash', pop: true }, effectContext(root, outcomes))
      await expect(lstat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
      const envelope = JSON.parse(result)
      expect(envelope).toMatchObject({ status: 'partial', error: { kind: 'conflict', code: 'GIT_LOCAL_EFFECT_OBSERVED', retryable: false }, partial: { effectResolution: 'effect-observed' } })
      expect(envelope.partial.effectEvidence).toMatch(/^effect-observed:[0-9a-f]{64}$/)
      expect(outcomes).toEqual([{ effectId: 'git-effect-1', state: 'effect-observed', evidence: envelope.partial.effectEvidence }])
      expect((await git(['rev-parse', 'refs/stash'])).stdout).toBe(stash)
      expect(await readFile(join(root, 'source.txt'), 'utf8')).toBe('committed version\n')
      expect((await git(['ls-files', '--unmerged'])).stdout).toContain('source.txt')
    } finally { await rm(parent, { recursive: true, force: true }) }
  })
}

it.skipIf(process.platform === 'win32')('restores a nonconflicting stash without needing a configured merge program', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'deepseek-git-plain-stash-'))
  const root = join(parent, 'repo')
  try {
    await repository(root)
    const git = (args: string[]) => execa('git', args, { cwd: root, env: scrubbedEnv(), extendEnv: false })
    await writeFile(join(root, '.gitattributes'), '*.txt merge=Fixture.Merge\n')
    await git(['add', '.gitattributes'])
    await git(['commit', '-m', 'merge attributes'])
    await writeFile(join(root, 'source.txt'), 'stashed work\n')
    expect(await Git.execute({ action: 'stash' }, context(root))).not.toMatch(/^Error:/)
    await writeFile(join(root, 'other.txt'), 'independent committed work\n')
    await git(['add', 'other.txt'])
    await git(['commit', '-m', 'independent change'])
    const marker = join(root, '.git', 'unneeded-merge-started')
    const helper = join(root, '.git', 'unneeded-merge')
    await writeFile(helper, `#!${process.execPath}\nawait Bun.write(${JSON.stringify(marker)}, 'executed')\n`, { mode: 0o700 })
    await git(['config', 'merge.Fixture.Merge.driver', helper])
    expect(await Git.execute({ action: 'stash', pop: true }, context(root))).not.toMatch(/^Error:/)
    expect(await readFile(join(root, 'source.txt'), 'utf8')).toBe('stashed work\n')
    expect(await readFile(join(root, 'other.txt'), 'utf8')).toBe('independent committed work\n')
    await expect(lstat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    const remaining = await execa('git', ['rev-parse', '--verify', 'refs/stash'], { cwd: root, env: scrubbedEnv(), extendEnv: false, reject: false })
    expect(remaining.exitCode).not.toBe(0)
  } finally { await rm(parent, { recursive: true, force: true }) }
})

it('refuses an oversized merge-driver inventory before restoring a stash', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'deepseek-git-merge-limit-'))
  const root = join(parent, 'repo')
  const driverCount = 600
  try {
    await repository(root)
    const git = (args: string[]) => execa('git', args, { cwd: root, env: scrubbedEnv(), extendEnv: false })
    await writeFile(join(root, 'source.txt'), 'stashed work\n')
    await git(['stash', 'push', '-m', 'preserve'])
    const stash = (await git(['rev-parse', 'refs/stash'])).stdout
    const config = join(root, '.git', 'config')
    const drivers = Array.from({ length: driverCount }, (_, index) => `[merge "driver${index}"]\n driver = false\n`).join('')
    await writeFile(config, `${await readFile(config, 'utf8')}\n${drivers}`)
    const inventory = await git(['config', '--null', '--name-only', '--get-regexp', '^merge\\..*\\.driver$'])
    expect(inventory.stdout.split('\0').filter(Boolean)).toHaveLength(driverCount)
    expect(await Git.execute({ action: 'stash', pop: true }, context(root))).toContain('Cannot inspect Git merge-driver configuration')
    expect((await git(['rev-parse', 'refs/stash'])).stdout).toBe(stash)
    expect((await readFile(join(root, 'source.txt'), 'utf8')).replace(/\r\n/g, '\n')).toBe('original\n')
  } finally { await rm(parent, { recursive: true, force: true }) }
})
