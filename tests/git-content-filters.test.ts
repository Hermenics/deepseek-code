import { expect, it } from 'bun:test'
import { lstat, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { Git } from '../src/tools/Git/Git.js'
import { runWorktreeGit } from '../src/utils/worktreeGit.js'
import { scrubbedEnv } from '../src/utils/platform.js'

for (const filter of ['clean', 'smudge', 'process'] as const) {
  it.skipIf(process.platform === 'win32')(`refuses a required ${filter} transformation without running its helper`, async () => {
    const parent = await mkdtemp(join(tmpdir(), 'deepseek-content-filter-'))
    const root = join(parent, 'repo')
    const target = join(parent, 'worktree')
    const marker = join(parent, 'filter-started')
    const git = (args: string[]) => execa('git', args, { cwd: root, env: scrubbedEnv(), extendEnv: false })
    try {
      await mkdir(root)
      await git(['init', '-b', 'filter-fixture'])
      await git(['config', 'user.name', 'Filter Test'])
      await git(['config', 'user.email', 'filter@example.invalid'])
      await writeFile(join(root, '.gitattributes'), '*.txt filter=Fixture.Transform\n')
      await writeFile(join(root, 'source.txt'), 'original\n')
      await git(['add', '.'])
      await git(['commit', '-m', 'fixture'])
      const helper = join(root, '.git', 'content-helper')
      await writeFile(helper, `#!${process.execPath}\nawait Bun.write(${JSON.stringify(marker)}, 'executed'); ${filter === 'process' ? '' : 'process.stdout.write(await Bun.stdin.text())'}\n`, { mode: 0o700 })
      await git(['config', `filter.Fixture.Transform.${filter}`, helper])
      await git(['config', 'filter.Fixture.Transform.required', 'false'])
      await writeFile(join(root, 'source.txt'), 'changed\n')
      const args = filter === 'smudge' ? ['worktree', 'add', '--detach', target, 'HEAD'] : ['add', '--', 'source.txt']
      const result = await runWorktreeGit(args, root, { reject: false })
      await expect(lstat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(result.exitCode).not.toBe(0)
      expect(await readFile(join(root, 'source.txt'), 'utf8')).toBe('changed\n')
      expect((await git(['show', ':source.txt'])).stdout).toBe('original')
      if (filter === 'clean') {
        const context = { sessionId: 'filter-fixture', workspacePath: root, projectRoot: root, permissionProfile: 'coordinator-integrator' as const }
        expect(await Git.execute({ action: 'status' }, context)).toContain(' M source.txt')
        expect(JSON.parse(await Git.execute({ action: 'diff' }, context))).toMatchObject({ status: 'error', error: { code: 'GIT_OPERATION_FAILED' } })
        expect(JSON.parse(await Git.execute({ action: 'add', files: ['source.txt'] }, context))).toMatchObject({
          status: 'error', error: { kind: 'conflict', code: 'GIT_LOCAL_EFFECT_UNKNOWN', retryable: false },
        })
        expect((await git(['show', ':source.txt'])).stdout).toBe('original')
        await expect(lstat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
      }
    } finally { await rm(parent, { recursive: true, force: true }) }
  })
}


it.skipIf(process.platform === 'win32')('allows ordinary Git operations when configured filters do not apply', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-unused-filter-'))
  const marker = join(root, '.git', 'unused-filter-started')
  const git = (args: string[]) => execa('git', args, { cwd: root, env: scrubbedEnv(), extendEnv: false })
  try {
    await git(['init', '-b', 'unused-filter-fixture'])
    const helper = join(root, '.git', 'unused-helper')
    await writeFile(helper, `#!${process.execPath}\nawait Bun.write(${JSON.stringify(marker)}, 'executed')\n`, { mode: 0o700 })
    await git(['config', 'filter.unused.process', helper])
    await writeFile(join(root, 'source.txt'), 'plain source\n')
    await runWorktreeGit(['add', '--', 'source.txt'], root)
    const result = await runWorktreeGit(['status', '--porcelain=v1'], root)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('source.txt')
    expect((await git(['show', ':source.txt'])).stdout).toBe('plain source')
    await expect(lstat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('refuses a truncated filter inventory before staging files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-filter-inventory-limit-'))
  try {
    await execa('git', ['init', '-b', 'inventory-limit'], { cwd: root })
    const config = join(root, '.git', 'config')
    const filters = Array.from({ length: 3500 }, (_, index) => `[filter "driver${index}"]\n clean = cat\n`).join('')
    await writeFile(config, `${await readFile(config, 'utf8')}\n${filters}`)
    await writeFile(join(root, 'source.txt'), 'unchanged source\n')
    await expect(runWorktreeGit(['add', '--', 'source.txt'], root)).rejects.toThrow('Cannot inspect Git content-filter configuration')
    await expect(lstat(join(root, '.git', 'index'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(root, 'source.txt'), 'utf8')).toBe('unchanged source\n')
  } finally { await rm(root, { recursive: true, force: true }) }
})
