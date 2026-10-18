import { expect, it } from 'bun:test'
import { lstat, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { Git } from '../src/tools/Git/Git.js'
import { scrubbedEnv } from '../src/utils/platform.js'

const git = (cwd: string, args: string[]) => execa('git', args, { cwd, env: scrubbedEnv(), extendEnv: false })
async function prepare(parent: string, phase: string) {
  const repo = join(parent, 'client')
  const remote = join(parent, 'remote.git')
  const publisher = join(parent, 'publisher')
  await mkdir(repo)
  await git(parent, ['init', '--bare', remote])
  await git(repo, ['init', '-b', 'main'])
  await git(repo, ['config', 'user.name', 'Pull Test'])
  await git(repo, ['config', 'user.email', 'pull@example.invalid'])
  await git(repo, ['config', 'pull.rebase', 'false'])
  await writeFile(join(repo, 'source.txt'), 'base\n')
  await writeFile(join(repo, 'local.txt'), 'local base\n')
  if (phase === 'smudge') await writeFile(join(repo, '.gitattributes'), '*.txt filter=Fixture.Transform\n')
  if (phase === 'merge-driver') await writeFile(join(repo, '.gitattributes'), '*.txt merge=Fixture.Merge\n')
  await git(repo, ['add', '.'])
  await git(repo, ['commit', '-m', 'base'])
  await git(repo, ['remote', 'add', 'origin', remote])
  await git(repo, ['push', '-u', 'origin', 'main'])
  await git(parent, ['clone', '--branch', 'main', remote, publisher])
  await git(publisher, ['config', 'user.name', 'Publisher Test'])
  await git(publisher, ['config', 'user.email', 'publisher@example.invalid'])
  await writeFile(join(publisher, 'source.txt'), 'remote advance\n')
  await git(publisher, ['add', 'source.txt'])
  await git(publisher, ['commit', '-m', 'remote advance'])
  await git(publisher, ['push'])
  if (phase !== 'smudge' && phase !== 'fast-forward') {
    await writeFile(join(repo, phase === 'merge-driver' ? 'source.txt' : 'local.txt'), 'local advance\n')
    await git(repo, ['add', '.'])
    await git(repo, ['commit', '-m', 'local advance'])
  }
  return { repo, remote, before: (await git(repo, ['rev-parse', 'HEAD'])).stdout }
}

for (const phase of ['smudge', 'merge-driver', 'signer', 'ssh-signer', 'x509-signer', 'ssh-key-selector', 'sequence-editor', 'merge-editor'] as const) {
  it.skipIf(process.platform === 'win32')(`pull does not execute a configured ${phase} program`, async () => {
    const parent = await mkdtemp(join(tmpdir(), 'deepseek-pull-program-'))
    try {
      const { repo, before } = await prepare(parent, phase)
      const marker = join(parent, 'program-started')
      const helper = join(repo, '.git', 'pull-helper')
      await writeFile(helper, `#!${process.execPath}\nawait Bun.write(${JSON.stringify(marker)}, 'executed'); ${phase === 'smudge' ? 'process.stdout.write(await Bun.stdin.text())' : ''}\n`, { mode: 0o700 })
      if (phase === 'smudge') await git(repo, ['config', 'filter.Fixture.Transform.smudge', helper])
      if (phase === 'merge-driver') await git(repo, ['config', 'merge.Fixture.Merge.driver', helper])
      if (phase === 'signer') {
        await git(repo, ['config', 'commit.gpgsign', 'true'])
        await git(repo, ['config', 'gpg.program', helper])
        await git(repo, ['config', 'gpg.openpgp.program', helper])
      }
      if (phase === 'ssh-signer' || phase === 'x509-signer') {
        const format = phase === 'ssh-signer' ? 'ssh' : 'x509'
        await git(repo, ['config', 'commit.gpgsign', 'true'])
        await git(repo, ['config', 'gpg.format', format])
        await git(repo, ['config', `gpg.${format}.program`, helper])
        if (format === 'ssh') {
          const key = join(repo, '.git', 'fixture-signing-key.pub')
          await writeFile(key, 'Fixture public key placeholder\n')
          await git(repo, ['config', 'user.signingkey', key])
        }
      }
      if (phase === 'ssh-key-selector') {
        await git(repo, ['config', 'commit.gpgsign', 'true'])
        await git(repo, ['config', 'gpg.format', 'ssh'])
        await git(repo, ['config', 'gpg.ssh.defaultKeyCommand', helper])
      }
      if (phase === 'sequence-editor') {
        await git(repo, ['config', 'pull.rebase', 'interactive'])
        await git(repo, ['config', 'sequence.editor', helper])
      }
      if (phase === 'merge-editor') {
        await git(repo, ['config', 'branch.main.mergeOptions', '--edit'])
        await git(repo, ['config', 'core.editor', helper])
      }
      const result = await Git.execute({ action: 'pull' }, { sessionId: 'pull-fixture', projectRoot: repo, workspacePath: repo, permissionProfile: 'coordinator-integrator', dangerousOperationApproved: true })
      await expect(lstat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
      if (phase === 'merge-editor') {
        expect(result).not.toMatch(/^Error:/)
        expect(await readFile(join(repo, 'source.txt'), 'utf8')).toBe('remote advance\n')
        expect(await readFile(join(repo, 'local.txt'), 'utf8')).toBe('local advance\n')
        expect((await git(repo, ['rev-list', '--parents', '-n', '1', 'HEAD'])).stdout.split(/\s+/)).toHaveLength(3)
      } else {
        expect(JSON.parse(result)).toMatchObject({ status: 'error', error: { kind: 'conflict', code: 'GIT_REMOTE_EFFECT_UNKNOWN', retryable: false } })
        expect((await git(repo, ['rev-parse', 'HEAD'])).stdout).toBe(before)
        if (phase === 'smudge') expect(await readFile(join(repo, 'source.txt'), 'utf8')).toBe('base\n')
        if (phase === 'merge-driver') {
          expect(await readFile(join(repo, 'source.txt'), 'utf8')).toBe('local advance\n')
          expect((await git(repo, ['ls-files', '--unmerged'])).stdout).toContain('source.txt')
        }
        if (phase === 'signer' || phase === 'ssh-signer' || phase === 'x509-signer' || phase === 'ssh-key-selector') {
          expect(await readFile(join(repo, 'local.txt'), 'utf8')).toBe('local advance\n')
          expect(await readFile(join(repo, 'source.txt'), 'utf8')).toBe('remote advance\n')
          expect((await lstat(join(repo, '.git', 'MERGE_HEAD'))).isFile()).toBe(true)
        }
      }
    } finally { await rm(parent, { recursive: true, force: true }) }
  }, 15_000)
}


for (const mode of ['fast-forward', 'standard-rebase'] as const) {
  it.skipIf(process.platform === 'win32')(`preserves ordinary ${mode} pull with configured but unneeded programs`, async () => {
    const parent = await mkdtemp(join(tmpdir(), 'deepseek-pull-ordinary-'))
    try {
      const { repo, before } = await prepare(parent, mode)
      const marker = join(parent, 'unused-program-started')
      const helper = join(repo, '.git', 'unused-pull-helper')
      await writeFile(helper, `#!${process.execPath}\nawait Bun.write(${JSON.stringify(marker)}, 'executed')\n`, { mode: 0o700 })
      for (const key of ['core.editor', 'sequence.editor', 'gpg.program', 'gpg.ssh.defaultKeyCommand', 'filter.unused.process', 'merge.unused.driver']) await git(repo, ['config', key, helper])
      await git(repo, ['config', 'commit.gpgsign', mode === 'fast-forward' ? 'true' : 'false'])
      await git(repo, ['config', 'pull.rebase', mode === 'standard-rebase' ? 'true' : 'false'])
      const result = await Git.execute({ action: 'pull' }, { sessionId: 'pull-fixture', projectRoot: repo, workspacePath: repo, permissionProfile: 'coordinator-integrator', dangerousOperationApproved: true })
      expect(result).not.toMatch(/^Error:/)
      await expect(lstat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readFile(join(repo, 'source.txt'), 'utf8')).toBe('remote advance\n')
      expect(await readFile(join(repo, 'local.txt'), 'utf8')).toBe(mode === 'standard-rebase' ? 'local advance\n' : 'local base\n')
      await git(repo, ['merge-base', '--is-ancestor', 'origin/main', 'HEAD'])
      expect((await git(repo, ['rev-parse', 'HEAD'])).stdout).not.toBe(before)
    } finally { await rm(parent, { recursive: true, force: true }) }
  }, 15_000)
}
