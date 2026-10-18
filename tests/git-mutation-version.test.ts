import { expect, it } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { captureGitMutationVersion } from '../src/agent/gitMutationVersion.js'

it('hashes staged state and sensitive configuration without returning configuration values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-mutation-version-'))
  const git = (args: string[]) => execa('git', args, { cwd: root })
  try {
    await git(['init', '-b', 'identity-fixture'])
    await writeFile(join(root, 'source.txt'), 'first\n')
    await git(['add', 'source.txt'])
    const canary = 'synthetic-git-configuration-canary'
    await git(['config', 'http.extraHeader', `Authorization: Bearer ${canary}`])
    const before = await captureGitMutationVersion(root)
    expect(JSON.stringify(before)).not.toContain(canary)
    expect(Object.keys(before).sort()).toEqual(['digest', 'root'])
    expect(await captureGitMutationVersion(root)).toEqual(before)
    await git(['config', 'http.extraHeader', `Authorization: Bearer changed-${canary}`])
    expect((await captureGitMutationVersion(root)).digest).not.toBe(before.digest)
    const controller = new AbortController()
    controller.abort(new Error('Mutation capture cancelled'))
    await expect(captureGitMutationVersion(root, controller.signal)).rejects.toThrow('Mutation capture cancelled')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('suppresses partial configuration output when Git exceeds the capture limit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-mutation-config-limit-'))
  const canary = 'synthetic-config-error-canary'
  try {
    await execa('git', ['init', '-b', 'limit-fixture'], { cwd: root })
    const path = join(root, '.git', 'config')
    await writeFile(path, `${await readFile(path, 'utf8')}\n[fixture]\n secret = ${canary}${'x'.repeat(4_300_000)}\n`)
    let failure: unknown
    try { await captureGitMutationVersion(root) } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(Error)
    expect(String(failure)).toBe('Error: Cannot capture Git index/configuration identity; no mutation was authorized')
    expect(String(failure)).not.toContain(canary)
  } finally { await rm(root, { recursive: true, force: true }) }
})
