import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import {
  createWorktree, enterWorktree, exitWorktree, generateWorktreeName, getActiveWorktree,
  isGitRepository, listWorktrees, validatePathUnderWorktrees, type WorktreeState,
} from '../src/agent/worktree.js'

let root = ''

async function initializeGit(): Promise<void> {
  await execa('git', ['init', '-q'], { cwd: root })
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  await execa('git', ['config', 'user.name', 'Test'], { cwd: root })
  await writeFile(join(root, 'tracked.txt'), 'base\n')
  await execa('git', ['add', '--', 'tracked.txt'], { cwd: root })
  await execa('git', ['commit', '-qm', 'base'], { cwd: root })
}

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'deepseek-wt-test-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('worktree path primitives', () => {
  it('detects Git repositories without depending on the process cwd', async () => {
    expect(isGitRepository(root)).toBe(false)
    await mkdir(join(root, '.git'))
    expect(isGitRepository(root)).toBe(true)
  })

  it('generates adjective-noun names without relying on a global cwd', () => {
    expect(generateWorktreeName()).toMatch(/^[a-z]+-[a-z]+$/)
    expect(new Set(Array.from({ length: 20 }, generateWorktreeName)).size).toBeGreaterThan(1)
  })

  it('accepts only explicit paths below the registered worktree root', () => {
    expect(validatePathUnderWorktrees(join(root, '.deepseek', 'worktrees', 'swift-fox'), root)).toBe(true)
    expect(validatePathUnderWorktrees(join(root, 'outside'), root)).toBe(false)
    expect(validatePathUnderWorktrees(join(root, '.deepseek', 'worktrees', '..', '..', 'escape'), root)).toBe(false)
    expect(validatePathUnderWorktrees('/tmp/evil', root)).toBe(false)
  })
})

describe('safe interactive worktrees', () => {
  it('refuses the old filesystem-copy fallback outside a Git repository', async () => {
    await expect(createWorktree(root)).rejects.toThrow('unsafe copied-workspace fallback')
    expect(await listWorktrees(root)).toEqual([])
  })

  it('creates, records, lists and re-enters a real Git worktree', async () => {
    await initializeGit()
    const created = await createWorktree(root, 'session')
    expect(created.isGitWorktree).toBe(true)
    expect(existsSync(join(created.path, '.git'))).toBe(true)
    expect((await getActiveWorktree(root))?.name).toBe(created.name)
    expect((await listWorktrees(root)).some(item => item.name === created.name)).toBe(true)

    await exitWorktree(root, true)
    const entered = await enterWorktree(root, created.name, 'session')
    expect(entered.path).toBe(created.path)
    expect((await getActiveWorktree(root))?.name).toBe(created.name)
  })

  it('removes only a clean Git worktree and records the history', async () => {
    await initializeGit()
    const created = await createWorktree(root)
    const result = await exitWorktree(root, false)
    expect(result).toContain('removed')
    expect(existsSync(created.path)).toBe(false)
    expect(await getActiveWorktree(root)).toBeNull()
    const state = JSON.parse(await readFile(join(root, '.deepseek', 'worktree-state.json'), 'utf8')) as WorktreeState
    expect(state.history.at(-1)?.name).toBe(created.name)
  })

  it('preserves dirty work and keeps it active for recovery', async () => {
    await initializeGit()
    const created = await createWorktree(root)
    await writeFile(join(created.path, 'uncommitted.txt'), 'do not lose\n')
    await expect(exitWorktree(root, false)).rejects.toThrow('uncommitted changes')
    expect(existsSync(join(created.path, 'uncommitted.txt'))).toBe(true)
    expect((await getActiveWorktree(root))?.name).toBe(created.name)
  })

  it('rejects missing names and reports an empty active state', async () => {
    await mkdir(join(root, '.deepseek'), { recursive: true })
    await expect(enterWorktree(root, 'missing')).rejects.toThrow('not found')
    expect(await exitWorktree(root, false)).toContain('No active worktree')
  })
})
