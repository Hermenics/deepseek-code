import { expect, it } from 'bun:test'
import { lstat, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { Git } from '../src/tools/Git/Git.js'
import { scrubbedEnv } from '../src/utils/platform.js'

const git = (cwd: string, args: string[], reject = true) => execa('git', args, { cwd, env: scrubbedEnv(), extendEnv: false, reject })
const context = (root: string, approved = true) => ({ sessionId: 'remote-fixture', workspacePath: root, projectRoot: root, permissionProfile: 'coordinator-integrator' as const, dangerousOperationApproved: approved })
async function fixture(root: string, name: string) {
  const repo = join(root, name)
  const remote = join(root, `${name}.git`)
  await mkdir(repo)
  await git(root, ['init', '--bare', remote])
  await git(repo, ['init', '-b', 'main'])
  await git(repo, ['config', 'user.name', 'Remote Test'])
  await git(repo, ['config', 'user.email', 'remote@example.invalid'])
  await writeFile(join(repo, 'source.txt'), `${name} base\n`)
  await git(repo, ['add', '.'])
  await git(repo, ['commit', '-m', 'fixture'])
  await git(repo, ['remote', 'add', 'origin', remote])
  await git(repo, ['push', '-u', 'origin', 'main'])
  return { repo, remote }
}
async function advance(repo: string, content: string) {
  await writeFile(join(repo, 'source.txt'), content)
  await git(repo, ['add', 'source.txt'])
  await git(repo, ['commit', '-m', 'advance fixture'])
  return (await git(repo, ['rev-parse', 'HEAD'])).stdout
}
async function publishRemoteChange(root: string, remote: string, content: string) {
  const publisher = join(root, 'publisher')
  await git(root, ['clone', '--branch', 'main', remote, publisher])
  await git(publisher, ['config', 'user.name', 'Publisher Test'])
  await git(publisher, ['config', 'user.email', 'publisher@example.invalid'])
  await advance(publisher, content)
  await git(publisher, ['push'])
}

for (const action of ['push', 'pull'] as const) for (const approved of [false, true]) {
  it(`${approved ? 'keeps' : 'refuses'} remote ${action} ${approved ? 'on the selected repository despite inherited overrides' : 'without confirmed coordinator authorization'}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-remote-git-'))
    const previousDir = process.env.GIT_DIR
    const previousTree = process.env.GIT_WORK_TREE
    try {
      const selected = await fixture(root, 'selected')
      const other = await fixture(root, 'other')
      let expectedHead = ''
      if (action === 'push') {
        expectedHead = await advance(selected.repo, 'selected advance\n')
        await advance(other.repo, 'other advance\n')
      } else {
        for (const item of [selected, other]) {
          const publisher = join(root, `${item.repo === selected.repo ? 'selected' : 'other'}-publisher`)
          await git(root, ['clone', '--branch', 'main', item.remote, publisher])
          await git(publisher, ['config', 'user.name', 'Publisher Test'])
          await git(publisher, ['config', 'user.email', 'publisher@example.invalid'])
          await advance(publisher, 'published advance\n')
          await git(publisher, ['push'])
        }
      }
      const target = action === 'push' ? selected.remote : selected.repo
      const ref = action === 'push' ? 'refs/heads/main' : 'HEAD'
      const before = (await git(target, ['rev-parse', ref])).stdout
      const otherBefore = (await git(action === 'push' ? other.remote : other.repo, ['rev-parse', action === 'push' ? 'refs/heads/main' : 'HEAD'])).stdout
      if (approved) { process.env.GIT_DIR = join(other.repo, '.git'); process.env.GIT_WORK_TREE = other.repo }
      const result = await Git.execute({ action }, context(selected.repo, approved))
      if (!approved) {
        expect(JSON.parse(result)).toMatchObject({ status: 'error', error: { code: 'GIT_OPERATION_FAILED' } })
        expect((await git(target, ['rev-parse', ref])).stdout).toBe(before)
      } else {
        expect(result).not.toMatch(/^Error:/)
        if (action === 'push') expect((await git(target, ['rev-parse', ref])).stdout).toBe(expectedHead)
        else expect((await readFile(join(selected.repo, 'source.txt'), 'utf8')).replace(/\r\n/g, '\n')).toBe('published advance\n')
        expect((await git(action === 'push' ? other.remote : other.repo, ['rev-parse', action === 'push' ? 'refs/heads/main' : 'HEAD'])).stdout).toBe(otherBefore)
      }
    } finally {
      if (previousDir === undefined) delete process.env.GIT_DIR
      else process.env.GIT_DIR = previousDir
      if (previousTree === undefined) delete process.env.GIT_WORK_TREE
      else process.env.GIT_WORK_TREE = previousTree
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)
}

it.skipIf(process.platform === 'win32')('scrubs Git process overrides and provider keys while retaining explicitly approved SSH-agent access', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-remote-git-env-'))
  const previousKey = process.env.DEEPSEEK_API_KEY
  const previousAgent = process.env.SSH_AUTH_SOCK
  const previousPath = process.env.PATH
  const previousGitSsh = process.env.GIT_SSH
  const previousGitSshCommand = process.env.GIT_SSH_COMMAND
  const previousGitConfigCount = process.env.GIT_CONFIG_COUNT
  const previousGitConfigKey = process.env.GIT_CONFIG_KEY_0
  const previousGitConfigValue = process.env.GIT_CONFIG_VALUE_0
  try {
    const selected = await fixture(root, 'selected')
    const expectedHead = await advance(selected.repo, 'pending publication\n')
    const probe = join(root, 'remote-environment.json')
    const realGit = Bun.which('git')
    if (!realGit) throw new Error('Git is required for this test')
    const bin = join(root, 'bin')
    await mkdir(bin)
    const recorder = join(root, 'record-environment.cjs')
    await writeFile(recorder, `const { writeFileSync } = require('node:fs')\nwriteFileSync(${JSON.stringify(probe)}, JSON.stringify({ providerKeyPresent: process.env.DEEPSEEK_API_KEY !== undefined, sshAgentPresent: process.env.SSH_AUTH_SOCK !== undefined, gitSshPresent: process.env.GIT_SSH !== undefined, gitSshCommandPresent: process.env.GIT_SSH_COMMAND !== undefined, gitConfigCountPresent: process.env.GIT_CONFIG_COUNT !== undefined }))\n`)
    const gitWrapper = join(bin, 'git')
    await writeFile(gitWrapper, `#!/bin/sh\n${JSON.stringify(process.execPath)} ${JSON.stringify(recorder)}\nexec ${JSON.stringify(realGit)} "$@"\n`, { mode: 0o700 })
    process.env.PATH = `${bin}:${previousPath ?? ''}`
    process.env.DEEPSEEK_API_KEY = 'synthetic-remote-provider-canary'
    process.env.SSH_AUTH_SOCK = join(root, 'fixture-agent.sock')
    process.env.GIT_SSH = 'synthetic-untrusted-ssh-wrapper'
    process.env.GIT_SSH_COMMAND = 'synthetic-untrusted-ssh-command'
    process.env.GIT_CONFIG_COUNT = '1'
    process.env.GIT_CONFIG_KEY_0 = 'core.sshCommand'
    process.env.GIT_CONFIG_VALUE_0 = 'synthetic-untrusted-config-command'
    expect(await Git.execute({ action: 'push' }, context(selected.repo))).not.toMatch(/^Error:/)
    expect(JSON.parse(await readFile(probe, 'utf8'))).toEqual({
      providerKeyPresent: false, sshAgentPresent: true, gitSshPresent: false, gitSshCommandPresent: false, gitConfigCountPresent: false,
    })
    expect((await git(selected.remote, ['rev-parse', 'refs/heads/main'])).stdout).toBe(expectedHead)
  } finally {
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previousKey
    if (previousAgent === undefined) delete process.env.SSH_AUTH_SOCK
    else process.env.SSH_AUTH_SOCK = previousAgent
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (previousGitSsh === undefined) delete process.env.GIT_SSH
    else process.env.GIT_SSH = previousGitSsh
    if (previousGitSshCommand === undefined) delete process.env.GIT_SSH_COMMAND
    else process.env.GIT_SSH_COMMAND = previousGitSshCommand
    if (previousGitConfigCount === undefined) delete process.env.GIT_CONFIG_COUNT
    else process.env.GIT_CONFIG_COUNT = previousGitConfigCount
    if (previousGitConfigKey === undefined) delete process.env.GIT_CONFIG_KEY_0
    else process.env.GIT_CONFIG_KEY_0 = previousGitConfigKey
    if (previousGitConfigValue === undefined) delete process.env.GIT_CONFIG_VALUE_0
    else process.env.GIT_CONFIG_VALUE_0 = previousGitConfigValue
    await rm(root, { recursive: true, force: true })
  }
})

it.skipIf(process.platform === 'win32')('publishes the selected commit without executing its native pre-push hook', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-remote-git-hook-'))
  try {
    const selected = await fixture(root, 'selected')
    const marker = join(selected.repo, '.git', 'pre-push-started')
    await writeFile(join(selected.repo, '.git', 'hooks', 'pre-push'), `#!${process.execPath}\nawait Bun.write(${JSON.stringify(marker)}, 'executed')\n`, { mode: 0o700 })
    await advance(selected.repo, 'control publication\n')
    await git(selected.repo, ['push'])
    expect((await lstat(marker)).isFile()).toBe(true)
    await rm(marker)
    const expected = await advance(selected.repo, 'protected publication\n')
    expect(await Git.execute({ action: 'push' }, context(selected.repo))).not.toMatch(/^Error:/)
    await expect(lstat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await git(selected.remote, ['rev-parse', 'refs/heads/main'])).stdout).toBe(expected)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('records a remotely accepted ref when a multi-ref push partially fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-remote-git-partial-push-'))
  try {
    const selected = await fixture(root, 'selected')
    const expectedMain = await advance(selected.repo, 'accepted update\n')
    await git(selected.repo, ['checkout', '-b', 'rejected'])
    await writeFile(join(selected.repo, 'source.txt'), 'rejected update\n')
    await git(selected.repo, ['add', 'source.txt'])
    await git(selected.repo, ['commit', '-m', 'rejected update'])
    await git(selected.repo, ['checkout', 'main'])
    await git(selected.repo, ['config', '--add', 'remote.origin.push', 'refs/heads/main:refs/heads/main'])
    await git(selected.repo, ['config', '--add', 'remote.origin.push', 'refs/heads/rejected:refs/heads/rejected'])
    await writeFile(join(selected.remote, 'hooks', 'update'), '#!/bin/sh\n[ "$1" = "refs/heads/rejected" ] && exit 1\nexit 0\n', { mode: 0o700 })

    const outcomes: Array<{ effectId: string; state: 'no-effect' | 'effect-observed'; evidence: string }> = []
    const result = JSON.parse(await Git.execute({ action: 'push' }, {
      ...context(selected.repo),
      effectId: 'partial-push-1',
      markEffectOutcome: async (effectId, state, evidence) => { outcomes.push({ effectId, state, evidence }) },
    }))

    expect(result).toMatchObject({
      status: 'partial',
      error: { kind: 'conflict', code: 'GIT_REMOTE_EFFECT_OBSERVED', retryable: false },
      partial: { effectResolution: 'effect-observed' },
    })
    expect(result.partial.effectEvidence).toMatch(/^git-push-update-observed:[0-9a-f]{64}$/)
    expect(outcomes).toEqual([{ effectId: 'partial-push-1', state: 'effect-observed', evidence: result.partial.effectEvidence }])
    expect((await git(selected.remote, ['rev-parse', 'refs/heads/main'])).stdout).toBe(expectedMain)
    expect((await git(selected.remote, ['show-ref', '--verify', '--quiet', 'refs/heads/rejected'], false)).exitCode).toBe(1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it.skipIf(process.platform === 'win32')('keeps a fully rejected remote push unknown because hooks may still run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-remote-git-rejected-'))
  try {
    const selected = await fixture(root, 'selected')
    const expectedMain = (await git(selected.remote, ['rev-parse', 'refs/heads/main'])).stdout
    await advance(selected.repo, 'rejected publication\n')
    await writeFile(join(selected.remote, 'hooks', 'update'), '#!/bin/sh\n[ "$1" = "refs/heads/main" ] && exit 1\nexit 0\n', { mode: 0o700 })

    const outcomes: Array<{ state: 'no-effect' | 'effect-observed'; evidence: string }> = []
    const result = JSON.parse(await Git.execute({ action: 'push' }, {
      ...context(selected.repo),
      effectId: 'rejected-push-1',
      markEffectOutcome: async (_effectId, state, evidence) => { outcomes.push({ state, evidence }) },
    }))

    expect(result).toMatchObject({ status: 'error', error: { kind: 'conflict', code: 'GIT_REMOTE_EFFECT_UNKNOWN', retryable: false } })
    expect(outcomes).toEqual([])
    expect((await git(selected.remote, ['rev-parse', 'refs/heads/main'])).stdout).toBe(expectedMain)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it.skipIf(process.platform === 'win32')('records a failed pull with changed local state as an observed partial effect', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-remote-git-partial-pull-'))
  try {
    const selected = await fixture(root, 'selected')
    await git(selected.repo, ['config', 'pull.rebase', 'false'])
    const publisher = join(root, 'publisher')
    await git(root, ['clone', '--branch', 'main', selected.remote, publisher])
    await git(publisher, ['config', 'user.name', 'Publisher Test'])
    await git(publisher, ['config', 'user.email', 'publisher@example.invalid'])
    await advance(publisher, 'remote conflicting change\n')
    await git(publisher, ['push'])
    await advance(selected.repo, 'local conflicting change\n')

    const outcomes: Array<{ effectId: string; state: 'no-effect' | 'effect-observed'; evidence: string }> = []
    const result = JSON.parse(await Git.execute({ action: 'pull' }, {
      ...context(selected.repo),
      effectId: 'partial-pull-1',
      markEffectOutcome: async (effectId, state, evidence) => { outcomes.push({ effectId, state, evidence }) },
    }))

    expect(result).toMatchObject({
      status: 'partial',
      error: { kind: 'conflict', code: 'GIT_REMOTE_EFFECT_OBSERVED', retryable: false },
      partial: { effectResolution: 'effect-observed' },
    })
    expect(result.partial.effectEvidence).toMatch(/^effect-observed:[0-9a-f]{64}$/)
    expect(outcomes).toEqual([{ effectId: 'partial-pull-1', state: 'effect-observed', evidence: result.partial.effectEvidence }])
    expect(await readFile(join(selected.repo, 'source.txt'), 'utf8')).toContain('<<<<<<<')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('records a successful fast-forward pull as a positive local effect', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-remote-git-observed-pull-'))
  try {
    const selected = await fixture(root, 'selected')
    await publishRemoteChange(root, selected.remote, 'published fast-forward\n')
    const outcomes: Array<{ effectId: string; state: 'no-effect' | 'effect-observed'; evidence: string }> = []

    const result = await Git.execute({ action: 'pull' }, {
      ...context(selected.repo),
      effectId: 'successful-pull-1',
      markEffectOutcome: async (effectId, state, evidence) => { outcomes.push({ effectId, state, evidence }) },
    })

    expect(result).toContain('Fast-forward')
    expect((await readFile(join(selected.repo, 'source.txt'), 'utf8')).replace(/\r\n/g, '\n')).toBe('published fast-forward\n')
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({ effectId: 'successful-pull-1', state: 'effect-observed' })
    expect(outcomes[0]?.evidence).toMatch(/^effect-observed:[0-9a-f]{64}$/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('leaves a successful no-op pull unresolved instead of inferring no effect', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-remote-git-noop-pull-'))
  try {
    const selected = await fixture(root, 'selected')
    const outcomes: Array<{ effectId: string; state: 'no-effect' | 'effect-observed'; evidence: string }> = []

    const result = await Git.execute({ action: 'pull' }, {
      ...context(selected.repo),
      effectId: 'noop-pull-1',
      markEffectOutcome: async (effectId, state, evidence) => { outcomes.push({ effectId, state, evidence }) },
    })

    expect(result).toMatch(/Already up.to.date/i)
    expect(outcomes).toEqual([])
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('preserves a successful pull result when recording its changed-state evidence fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-remote-git-pull-evidence-failure-'))
  try {
    const selected = await fixture(root, 'selected')
    await publishRemoteChange(root, selected.remote, 'published despite evidence failure\n')

    const result = await Git.execute({ action: 'pull' }, {
      ...context(selected.repo),
      effectId: 'pull-evidence-failure-1',
      markEffectOutcome: async () => { throw new Error('checkpoint unavailable') },
    })

    expect(result).toContain('Fast-forward')
    expect((await readFile(join(selected.repo, 'source.txt'), 'utf8')).replace(/\r\n/g, '\n')).toBe('published despite evidence failure\n')
  } finally { await rm(root, { recursive: true, force: true }) }
})
