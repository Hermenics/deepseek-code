import { afterEach, describe, expect, it } from 'bun:test'
import { access, mkdtemp, mkdir, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { OrchestratorSession } from '../src/orchestration/index.js'
import { resolveExternalApprovalDirectory, resolveSafePath } from '../src/tools/shared/pathSafety.js'
import { Shell } from '../src/tools/Shell/Shell.js'
import { WriteFile } from '../src/tools/WriteFile/WriteFile.js'
import { Git } from '../src/tools/Git/Git.js'
import { acquireFileLease } from '../src/orchestration/fileLease.js'

const roots: string[] = []

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

async function gitRepo(): Promise<string> {
  const root = await tempRoot('deepseek-mas-git-')
  await execa('git', ['init', '-q'], { cwd: root })
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  await execa('git', ['config', 'user.name', 'Test'], { cwd: root })
  await writeFile(join(root, 'file.txt'), 'base\n')
  await execa('git', ['add', '--', 'file.txt'], { cwd: root })
  await execa('git', ['commit', '-qm', 'base'], { cwd: root })
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('task workspace isolation', () => {
  it('gives concurrent writers distinct worktrees and integrates a checked patch', async () => {
    const root = await gitRepo()
    const session = new OrchestratorSession({ projectRoot: root, logFile: null })
    const first = await session.workspaces.acquire('writer-one', 'writer-worktree')
    const second = await session.workspaces.acquire('writer-two', 'writer-worktree')
    expect(first.workspace.path).not.toBe(second.workspace.path)
    expect(process.cwd()).not.toBe(first.workspace.path)
    await writeFile(join(first.workspace.path, 'file.txt'), 'writer one\n')
    const integrated = await session.workspaces.integrate('writer-one')
    expect(integrated.integrated).toBe(true)
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('writer one\n')
    expect(await session.workspaces.cleanup('writer-one')).toBe(true)
    await second.release()
  })

  it('reports integration conflicts and preserves the worktree', async () => {
    const root = await gitRepo()
    const session = new OrchestratorSession({ projectRoot: root, logFile: null })
    const lease = await session.workspaces.acquire('writer', 'writer-worktree')
    await writeFile(join(lease.workspace.path, 'file.txt'), 'worker\n')
    await writeFile(join(root, 'file.txt'), 'parent\n')
    const result = await session.workspaces.integrate('writer')
    expect(result.integrated).toBe(false)
    expect(result.conflict).toContain('local changes')
    expect(await session.workspaces.cleanup('writer')).toBe(false)
  })

  it('serializes concurrent integrations around check and apply', async () => {
    // Bumped from Bun's 5000ms default: this test runs 2 worktree creates plus
    // 2 concurrent integrates (each several git subprocesses) and once hit
    // 5462ms under full-suite CPU load. 15s keeps slow-CI headroom while a
    // genuinely stuck lease (reclaimed only after 30s) still fails the test.
    const root = await gitRepo()
    await writeFile(join(root, 'other.txt'), 'base\n')
    await execa('git', ['add', '--', 'other.txt'], { cwd: root })
    await execa('git', ['commit', '-qm', 'other'], { cwd: root })
    const session = new OrchestratorSession({ projectRoot: root, logFile: null, snapshotFile: null })
    const first = await session.workspaces.acquire('integration-one', 'writer-worktree')
    const second = await session.workspaces.acquire('integration-two', 'writer-worktree')
    await writeFile(join(first.workspace.path, 'file.txt'), 'first\n')
    await writeFile(join(second.workspace.path, 'other.txt'), 'second\n')
    const [one, two] = await Promise.all([
      session.workspaces.integrate('integration-one'), session.workspaces.integrate('integration-two'),
    ])
    expect(one.integrated).toBe(true)
    expect(two.integrated).toBe(true)
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('first\n')
    expect(await readFile(join(root, 'other.txt'), 'utf8')).toBe('second\n')
  }, 15_000)

  it('refuses cleanup when ignored work remains after integration', async () => {
    const root = await gitRepo()
    const session = new OrchestratorSession({ projectRoot: root, logFile: null })
    const lease = await session.workspaces.acquire('writer', 'writer-worktree')
    await writeFile(join(lease.workspace.path, '.gitignore'), '*.private\n')
    expect((await session.workspaces.integrate('writer')).integrated).toBe(true)
    await writeFile(join(lease.workspace.path, 'notes.private'), 'preserve me\n')
    expect(await session.workspaces.cleanup('writer')).toBe(false)
  })

  it('refuses to integrate secrets or runtime control files from a writer shell', async () => {
    const root = await gitRepo()
    const session = new OrchestratorSession({ projectRoot: root, logFile: null, snapshotFile: null })
    const lease = await session.workspaces.acquire('writer-secret', 'writer-worktree')
    await writeFile(join(lease.workspace.path, 'private.pem'), 'secret')
    const result = await session.workspaces.integrate('writer-secret')
    expect(result.integrated).toBe(false)
    expect(result.conflict).toContain('protected path')
    await expect(access(join(root, 'private.pem'))).rejects.toThrow()
  })

  it('serializes writers across sessions when Git worktrees are unavailable', async () => {
    const root = await tempRoot('deepseek-mas-plain-')
    const firstSession = new OrchestratorSession({ sessionId: 'first-session', projectRoot: root, logFile: null, snapshotFile: null })
    const secondSession = new OrchestratorSession({ sessionId: 'second-session', projectRoot: root, logFile: null, snapshotFile: null })
    const first = await firstSession.workspaces.acquire('first', 'writer-worktree')
    let secondReady = false
    const secondPromise = secondSession.workspaces.acquire('second', 'writer-worktree').then(lease => { secondReady = true; return lease })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(first.workspace.isolation).toBe('serialized-writer')
    expect(secondReady).toBe(false)
    await first.release()
    const second = await secondPromise
    expect(second.workspace.isolation).toBe('serialized-writer')
    await second.release()
  })

  it('rejects a second active lease for the same serialized writer', async () => {
    const root = await tempRoot('deepseek-mas-plain-')
    const session = new OrchestratorSession({ projectRoot: root, logFile: null, snapshotFile: null })
    const lease = await session.workspaces.acquire('writer', 'writer-worktree')
    await expect(session.workspaces.acquire('writer', 'writer-worktree')).rejects.toThrow('already leased')
    await lease.release()
  })

  it('uses the same project lease for serialized writers and integration', async () => {
    const root = await gitRepo()
    const isolated = new OrchestratorSession({ sessionId: 'isolated', projectRoot: root, logFile: null, snapshotFile: null })
    const worktree = await isolated.workspaces.acquire('worktree', 'writer-worktree')
    await writeFile(join(worktree.workspace.path, 'file.txt'), 'isolated\n')
    await writeFile(join(root, 'unrelated.txt'), 'dirty parent\n')
    const serialized = new OrchestratorSession({ sessionId: 'serialized', projectRoot: root, logFile: null, snapshotFile: null })
    const writer = await serialized.workspaces.acquire('writer', 'writer-worktree')
    let finished = false
    const integration = isolated.workspaces.integrate('worktree').then(result => { finished = true; return result })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(finished).toBe(false)
    await writer.release()
    expect((await integration).integrated).toBe(true)
  })

  it('serializes a writer on a dirty parent so it sees the active checkout state', async () => {
    const root = await gitRepo()
    await writeFile(join(root, 'file.txt'), 'uncommitted parent state\n')
    const session = new OrchestratorSession({ projectRoot: root, logFile: null, snapshotFile: null })
    const lease = await session.workspaces.acquire('dirty-writer', 'writer-worktree')
    expect(lease.workspace.isolation).toBe('serialized-writer')
    expect(lease.workspace.path).toBe(root)
    expect(await readFile(join(lease.workspace.path, 'file.txt'), 'utf8')).toContain('uncommitted parent state')
    await lease.release()
  })

  it('translates parent paths and rejects new-file symlink escapes', async () => {
    const root = await tempRoot('deepseek-mas-path-')
    const workspace = await tempRoot('deepseek-mas-workspace-')
    await mkdir(join(root, 'src'))
    await mkdir(join(workspace, 'src'))
    const context = { sessionId: 's', workspacePath: workspace, projectRoot: root, permissionProfile: 'writer-worktree' as const }
    expect(await resolveSafePath(join(root, 'src', 'file.ts'), context)).toBe(join(workspace, 'src', 'file.ts'))
    const outside = await tempRoot('deepseek-mas-outside-')
    await symlink(outside, join(workspace, 'escape'))
    await expect(resolveSafePath('escape/new/file.ts', context)).rejects.toThrow('symlink')
    await writeFile(join(workspace, '.env'), 'secret')
    await symlink('.env', join(workspace, 'safe.txt'))
    await expect(resolveSafePath('safe.txt', context)).rejects.toThrow('sensitive')
  })

  it('allows only valid flat project workflow files under .deepseek', async () => {
    const root = await tempRoot('deepseek-workflow-path-')
    const context = { sessionId: 's', workspacePath: root, projectRoot: root, permissionProfile: 'coordinator-integrator' as const }
    const path = '.deepseek/workflows/review.js'

    await WriteFile.execute({ path, content: 'export const meta = {"name":"review"}; return 1;' }, context)
    expect(await readFile(join(root, path), 'utf8')).toContain('"name":"review"')
    await expect(WriteFile.execute({ path: '.deepseek/workflows/bad.js', content: 'export const meta = { name: "bad" }; return 1;' }, context)).rejects.toThrow('JSON-compatible')
    await expect(resolveSafePath('.deepseek/settings.json', context)).rejects.toThrow('off-limits')
    await expect(resolveSafePath('.deepseek/workflows/nested/review.js', context)).rejects.toThrow('off-limits')
  })

  it('limits approved external paths to their selected directory', async () => {
    const workspace = await tempRoot('deepseek-mas-workspace-')
    const external = await tempRoot('deepseek-mas-external-')
    const sibling = await tempRoot('deepseek-mas-sibling-')
    await mkdir(join(external, 'nested'))
    await writeFile(join(external, 'nested', 'allowed.txt'), 'ok')
    const context = {
      sessionId: 's', workspacePath: workspace, projectRoot: workspace,
      permissionProfile: 'coordinator-integrator' as const, approvedExternalPaths: [external],
    }

    expect(await resolveSafePath(join(external, 'nested', 'allowed.txt'), context)).toBe(join(external, 'nested', 'allowed.txt'))
    const linkedExternal = join(workspace, 'linked-external')
    await symlink(external, linkedExternal)
    expect(await resolveSafePath(join(linkedExternal, 'nested', 'allowed.txt'), context)).toBe(join(linkedExternal, 'nested', 'allowed.txt'))
    await expect(resolveSafePath(join(sibling, 'blocked.txt'), context)).rejects.toThrow('outside the working directory')
    expect(await resolveExternalApprovalDirectory(join(external, 'new', 'file.txt'), false, context)).toBe(external)

    await writeFile(join(external, '.env'), 'secret')
    await expect(resolveSafePath(join(external, '.env'), context)).rejects.toThrow('sensitive')
    const externalWorkflow = join(external, '.deepseek', 'workflows', 'review.js')
    await mkdir(join(external, '.deepseek', 'workflows'), { recursive: true })
    await expect(resolveSafePath(externalWorkflow, context)).rejects.toThrow('off-limits')
    await expect(WriteFile.execute({ path: externalWorkflow, content: 'not a workflow' }, context)).rejects.toThrow('off-limits')
    await symlink(sibling, join(external, 'escape'))
    await expect(resolveSafePath(join(external, 'escape', 'file.txt'), context)).rejects.toThrow('symlink')
  })

  it('reclaims an old incomplete filesystem lease', async () => {
    const resource = `incomplete-${randomUUID()}`
    const leasePath = join(tmpdir(), 'deepseek-code-leases-v1', createHash('sha256').update(resource).digest('hex'))
    await mkdir(leasePath, { recursive: true })
    const old = new Date(Date.now() - 31_000)
    await utimes(leasePath, old, old)
    const lease = await acquireFileLease(resource)
    expect(lease.path).toBe(leasePath)
    await lease.release()
  })

  it('creates and switches branches without pathspec ambiguity', async () => {
    const root = await gitRepo()
    const context = { sessionId: 's', workspacePath: root, projectRoot: root, permissionProfile: 'coordinator-integrator' as const }
    const initialBranch = (await execa('git', ['branch', '--show-current'], { cwd: root })).stdout
    const initial = (await execa('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout
    expect(await Git.execute({ action: 'branch', create: 'review-fix' }, context)).toContain('Created')
    expect(await Git.execute({ action: 'branch', switch: initialBranch }, context)).toContain('Switched')
    expect((await execa('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout).toBe(initial)
    expect(await Git.execute({ action: 'branch', switch: '--evil' }, context)).toContain('Error')
  })

  it('sandboxes tester shell to a read-only workspace and strips inherited state', async () => {
    const root = await tempRoot('deepseek-mas-shell-')
    const context = { sessionId: 's', workspacePath: root, projectRoot: root, permissionProfile: 'tester' as const }
    const result = await Shell.execute({ command: 'pwd; touch local.txt; bun --version >/dev/null; test ! -e "$HOME/.ssh"; test ! -e /etc/passwd; printf ":safe"' }, context)
    expect(result).toContain('/mnt')
    expect(result).toContain(':safe')
    await expect(access(join(root, 'local.txt'))).rejects.toThrow()
  })

  it('requires an explicit runtime authorization marker for dangerous coordinator shell calls', async () => {
    const root = await tempRoot('deepseek-mas-shell-')
    const result = await Shell.execute({ command: 'git reset --hard' }, {
      sessionId: 's', workspacePath: root, projectRoot: root, permissionProfile: 'coordinator-integrator',
    })
    expect(result).toContain('blocked')
  })

  it('prevents file effects after cancellation and shell effects in serialized fallback', async () => {
    const root = await tempRoot('deepseek-mas-abort-')
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    const context = {
      sessionId: 's', workspacePath: root, projectRoot: root, permissionProfile: 'writer-worktree' as const,
      workspaceIsolation: 'serialized-writer' as const, signal: controller.signal,
    }
    await expect(WriteFile.execute({ path: 'side-effect.txt', content: 'no' }, context)).rejects.toThrow('cancelled')
    await expect(access(join(root, 'side-effect.txt'))).rejects.toThrow()
    const shell = await Shell.execute({ command: 'touch shell-effect.txt' }, { ...context, signal: undefined })
    expect(shell).toContain('blocked')
    await expect(access(join(root, 'shell-effect.txt'))).rejects.toThrow()
  })
})
