import { describe, it, expect } from 'bun:test'
import { lstat, mkdtemp, mkdir, rm, writeFile, symlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { execa } from 'execa'
import { assertCapturedWorkspaceInputsUnchanged, captureWorkspaceVersion, diffWorkspaceFileDigests, restoreWorkspaceFileDigests, serializeWorkspaceFileDigests } from '../src/agent/workspaceVersion.js'
import { collectEnvironmentInfo } from '../src/agent/environment.js'

async function tempDir(prefix: string): Promise<string> { return mkdtemp(join(tmpdir(), prefix)) }
async function git(cwd: string, args: string[]) { return execa('git', args, { cwd }) }

describe('captureWorkspaceVersion', () => {
  it('uses repository root and root HEAD/branch when called from a Git subdirectory', async () => {
    const parent = await tempDir('dsk-workspace-git-')
    try {
      const repo = join(parent, 'repo')
      const nested = join(repo, 'packages', 'app')
      await mkdir(nested, { recursive: true })
      await writeFile(join(repo, 'root.ts'), 'root')
      await writeFile(join(nested, 'app.ts'), 'app')
      await git(repo, ['init', '-b', 'research-test'])
      await git(repo, ['config', 'user.name', 'Workspace Test'])
      await git(repo, ['config', 'user.email', 'workspace-test@example.invalid'])
      await git(repo, ['add', '.'])
      await git(repo, ['commit', '-m', 'initial'])

      const result = await captureWorkspaceVersion(nested)
      const head = await git(repo, ['rev-parse', 'HEAD'])
      expect(result.root).toBe(resolve(repo))
      expect(result.head).toBe(head.stdout.trim())
      expect(result.branch).toBe('research-test')
      expect(result.fileCount).toBe(2)
    } finally { await rm(parent, { recursive: true, force: true }) }
  })

  it('supports non-Git workspaces when git is absent and honors pre-aborted signals', async () => {
    const parent = await tempDir('dsk-workspace-no-git-')
    const oldPath = process.env.PATH
    try {
      const workspace = join(parent, 'source')
      await mkdir(workspace)
      await writeFile(join(workspace, 'main.ts'), 'export const ok = true')
      process.env.PATH = join(parent, 'empty-bin')
      await mkdir(process.env.PATH)
      const result = await captureWorkspaceVersion(workspace)
      expect(result.root).toBe(resolve(workspace))
      expect(result.head).toBeNull()
      expect(result.branch).toBeNull()
      expect(result.fileCount).toBe(1)
      const controller = new AbortController()
      controller.abort(new Error('cancelled fingerprint'))
      await expect(captureWorkspaceVersion(workspace, controller.signal)).rejects.toThrow('cancelled fingerprint')
    } finally {
      if (oldPath === undefined) delete process.env.PATH
      else process.env.PATH = oldPath
      await rm(parent, { recursive: true, force: true })
    }
  })

  it('changes the digest when source content changes or a file is deleted', async () => {
    const workspace = await tempDir('dsk-workspace-mutations-')
    try {
      const source = join(workspace, 'src.ts')
      const removed = join(workspace, 'remove.ts')
      await writeFile(source, 'v1')
      await writeFile(removed, 'to delete')
      const first = await captureWorkspaceVersion(workspace)
      await writeFile(source, 'v2')
      const changed = await captureWorkspaceVersion(workspace)
      expect(changed.digest).not.toBe(first.digest)
      await rm(removed)
      const deleted = await captureWorkspaceVersion(workspace)
      expect(deleted.digest).not.toBe(changed.digest)
      expect(deleted.fileCount).toBe(changed.fileCount - 1)
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })

  it('optionally retains per-file digests and reports bounded add, change, and delete details', async () => {
    const workspace = await tempDir('dsk-workspace-file-diff-')
    try {
      await writeFile(join(workspace, 'changed.ts'), 'before')
      await writeFile(join(workspace, 'removed.ts'), 'remove')
      const before = await captureWorkspaceVersion(workspace, undefined, [], { includeFileDigests: true })
      await writeFile(join(workspace, 'changed.ts'), 'after')
      await rm(join(workspace, 'removed.ts'))
      await writeFile(join(workspace, 'added.ts'), 'add')
      const after = await captureWorkspaceVersion(workspace, undefined, [], { includeFileDigests: true })

      expect([...before.fileDigests!.keys()].sort()).toEqual(['changed.ts', 'removed.ts'])
      expect(diffWorkspaceFileDigests(before.fileDigests!, after.fileDigests!)).toEqual({
        changes: [
          { path: 'added.ts', change: 'added' },
          { path: 'changed.ts', change: 'modified' },
          { path: 'removed.ts', change: 'removed' },
        ],
        omitted: 0,
      })
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })

  it('caps reported file changes while retaining the exact omitted count', () => {
    const before = new Map<string, string>()
    const after = new Map(Array.from({ length: 103 }, (_, index) => [`file-${String(index).padStart(3, '0')}.ts`, 'hash']))
    const result = diffWorkspaceFileDigests(before, after)
    expect(result.changes).toHaveLength(100)
    expect(result.changes[0]).toEqual({ path: 'file-000.ts', change: 'added' })
    expect(result.omitted).toBe(3)
  })

  it('round-trips only bounded relative-path manifests', () => {
    const baseline = new Map([['src/app.ts', '100644\0abc123'], ['empty.ts', '100644\0def456']])
    const persisted = serializeWorkspaceFileDigests(baseline)
    expect(restoreWorkspaceFileDigests(persisted)).toEqual(baseline)
    expect(restoreWorkspaceFileDigests([])).toEqual(new Map())
    expect(restoreWorkspaceFileDigests([['../outside.ts', 'digest']])).toBeUndefined()
    expect(serializeWorkspaceFileDigests(new Map([['token=secret.ts', 'digest']]))).toBeUndefined()
    expect(serializeWorkspaceFileDigests(new Map([['large.ts', 'x'.repeat(512 * 1024)]]))).toBeUndefined()
  })

  it('omits credentials and excluded generated/dependency outputs from the fingerprint', async () => {
    const workspace = await tempDir('dsk-workspace-exclusions-')
    try {
      await writeFile(join(workspace, 'app.ts'), 'app')
      await writeFile(join(workspace, '.env'), 'SECRET=one')
      await writeFile(join(workspace, 'credentials.json'), '{"token":"one"}')
      for (const directory of ['dist', 'coverage', 'node_modules', '.deepseek', '.deepseek-code', '__eval_check__']) {
        const path = join(workspace, directory)
        await mkdir(path)
        await writeFile(join(path, 'generated.js'), 'generated one')
      }
      const first = await captureWorkspaceVersion(workspace)
      await writeFile(join(workspace, '.env'), 'SECRET=two')
      await writeFile(join(workspace, 'credentials.json'), '{"token":"two"}')
      for (const directory of ['dist', 'coverage', 'node_modules', '.deepseek', '.deepseek-code', '__eval_check__']) {
        await writeFile(join(workspace, directory, 'generated.js'), 'generated two')
      }
      const second = await captureWorkspaceVersion(workspace)
      expect(second.digest).toBe(first.digest)
      expect(first.fileCount).toBe(1)
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })

  it('excludes workflow state without excluding project inputs', async () => {
    const workspace = await tempDir('dsk-workspace-runtime-state-')
    try {
      const source = join(workspace, 'src.ts')
      const state = join(workspace, 'state')
      await mkdir(state)
      await writeFile(source, 'source one')
      await writeFile(join(state, 'run.json'), 'run one')
      const first = await captureWorkspaceVersion(workspace, undefined, [state])
      await writeFile(join(state, 'run.json'), 'run two')
      const runtimeChanged = await captureWorkspaceVersion(workspace, undefined, [state])
      expect(runtimeChanged.digest).toBe(first.digest)
      await writeFile(source, 'source two')
      const sourceChanged = await captureWorkspaceVersion(workspace, undefined, [state])
      expect(sourceChanged.digest).not.toBe(runtimeChanged.digest)
      expect(sourceChanged.fileCount).toBe(1)
      await expect(captureWorkspaceVersion(workspace, undefined, [workspace])).rejects.toThrow('cannot exclude its root')
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })

  it('fails closed for outward symlinks without reading external file contents', async () => {
    const parent = await tempDir('dsk-workspace-symlink-')
    try {
      const workspace = join(parent, 'workspace')
      const outside = join(parent, 'outside')
      await mkdir(workspace)
      await mkdir(outside)
      await writeFile(join(outside, 'credentials.txt'), 'private-one')
      await symlink(outside, join(workspace, 'external'))
      await expect(captureWorkspaceVersion(workspace)).rejects.toThrow(/escapes verification root/)
      await writeFile(join(outside, 'credentials.txt'), 'private-two')
      await expect(captureWorkspaceVersion(workspace)).rejects.toThrow(/escapes verification root/)
    } finally { await rm(parent, { recursive: true, force: true }) }
  })

  it('hashes an enumerated in-root file reached through a symlink', async () => {
    const workspace = await tempDir('dsk-workspace-internal-link-')
    try {
      await writeFile(join(workspace, 'source.ts'), 'version one')
      await symlink(join(workspace, 'source.ts'), join(workspace, 'alias.ts'))
      const first = await captureWorkspaceVersion(workspace)
      await writeFile(join(workspace, 'source.ts'), 'version two')
      const second = await captureWorkspaceVersion(workspace)
      expect(second.digest).not.toBe(first.digest)
      expect(first.fileCount).toBe(2)
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })

  it('fails closed when a source symlink targets a sensitive file inside the workspace', async () => {
    const workspace = await tempDir('dsk-workspace-sensitive-link-')
    try {
      await writeFile(join(workspace, 'credentials.json'), '{"secret":"not-read"}')
      await symlink(join(workspace, 'credentials.json'), join(workspace, 'runtime-config.ts'))
      await expect(captureWorkspaceVersion(workspace)).rejects.toThrow(/sensitive input/)
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })

  it('rejects a file changed after it was hashed but before the digest is accepted', async () => {
    const workspace = await tempDir('dsk-workspace-mixed-epoch-')
    try {
      const firstFile = join(workspace, 'a.ts')
      await writeFile(firstFile, 'initial')
      const before = await lstat(firstFile, { bigint: true })
      const identity = [before.dev, before.ino, before.mode, before.size, before.mtimeNs, before.ctimeNs].join(':')
      await writeFile(firstFile, 'changed after its hash')
      await expect(assertCapturedWorkspaceInputsUnchanged(workspace, new Map([['a.ts', identity]])))
        .rejects.toThrow(/changed while fingerprinting/)
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })
})

for (const mutation of ['clone', 'worktree', 'branch', 'commit', 'cwd'] as const) {
  it(`binds identical source bytes to the execution ${mutation} identity`, async () => {
    const parent = await tempDir('dsk-workspace-identity-')
    try {
      const repo = join(parent, 'repo')
      await mkdir(join(repo, 'package'), { recursive: true })
      await writeFile(join(repo, 'package', 'app.ts'), 'export const value = 1\n')
      await git(repo, ['init', '-b', 'identity-main'])
      await git(repo, ['config', 'user.name', 'Workspace Test'])
      await git(repo, ['config', 'user.email', 'workspace-test@example.invalid'])
      await git(repo, ['add', '.'])
      await git(repo, ['commit', '-m', 'initial'])
      const before = await captureWorkspaceVersion(repo)
      let target = repo
      if (mutation === 'clone') {
        target = join(parent, 'clone')
        await git(parent, ['clone', '--local', repo, target])
      } else if (mutation === 'worktree') {
        target = join(parent, 'linked-worktree')
        await git(repo, ['worktree', 'add', '--detach', target, 'HEAD'])
      } else if (mutation === 'branch') await git(repo, ['checkout', '-b', 'identity-other'])
      else if (mutation === 'commit') await git(repo, ['commit', '--allow-empty', '-m', 'same tree'])
      else target = join(repo, 'package')
      const after = await captureWorkspaceVersion(target)
      expect(after.fileCount).toBe(before.fileCount)
      expect(after.digest).not.toBe(before.digest)
      if (mutation === 'clone' || mutation === 'cwd') {
        expect(after.head).toBe(before.head)
        expect(after.branch).toBe(before.branch)
      }
    } finally { await rm(parent, { recursive: true, force: true }) }
  })
}

it('ignores inherited Git repository overrides when identifying the workspace', async () => {
  const parent = await tempDir('dsk-workspace-git-env-')
  const previousDir = process.env.GIT_DIR
  const previousTree = process.env.GIT_WORK_TREE
  try {
    const original = join(parent, 'original')
    const unrelated = join(parent, 'unrelated')
    for (const repo of [original, unrelated]) {
      await mkdir(repo)
      await git(repo, ['init', '-b', repo === original ? 'original' : 'unrelated'])
      await writeFile(join(repo, 'source.ts'), 'same contents')
    }
    process.env.GIT_DIR = join(unrelated, '.git')
    process.env.GIT_WORK_TREE = unrelated
    const captured = await captureWorkspaceVersion(original)
    expect(captured.root).toBe(original)
    expect(captured.branch).toBe('original')
    const environment = await collectEnvironmentInfo({ workingDirectory: original, model: 'fixture', provider: 'local' })
    expect(environment.gitBranch).toBe('original')
  } finally {
    if (previousDir === undefined) delete process.env.GIT_DIR
    else process.env.GIT_DIR = previousDir
    if (previousTree === undefined) delete process.env.GIT_WORK_TREE
    else process.env.GIT_WORK_TREE = previousTree
    await rm(parent, { recursive: true, force: true })
  }
})

it.skipIf(process.platform === 'win32')('does not execute a repository fsmonitor helper while fingerprinting', async () => {
  const parent = await tempDir('dsk-workspace-fsmonitor-')
  try {
    const repo = join(parent, 'repo')
    const marker = join(parent, 'helper-started')
    await mkdir(repo)
    await git(repo, ['init', '-b', 'safe-inspection'])
    await writeFile(join(repo, 'source.ts'), 'source')
    await git(repo, ['add', '.'])
    const helper = join(repo, '.git', 'fsmonitor-fixture')
    await writeFile(helper, `#!${process.execPath}\nawait Bun.write(${JSON.stringify(marker)}, 'helper executed'); process.stdout.write('fixture-token\\0')\n`, { mode: 0o700 })
    await git(repo, ['config', 'core.fsmonitor', helper])
    const captured = await captureWorkspaceVersion(repo)
    expect(captured.root).toBe(repo)
    await expect(lstat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await rm(parent, { recursive: true, force: true }) }
})
