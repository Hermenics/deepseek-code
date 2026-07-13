import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import {
  generateWorktreeName,
  createWorktree,
  enterWorktree,
  exitWorktree,
  listWorktrees,
  getActiveWorktree,
  validatePathUnderWorktrees,
  type WorktreeState,
} from '../src/agent/worktree.js'

let tmpDir: string
let originalCwd: string

beforeEach(async () => {
  originalCwd = process.cwd()
  tmpDir = await mkdtemp(join(tmpdir(), 'deepseek-wt-test-'))
})

afterEach(async () => {
  // Always restore cwd before cleanup — exitWorktree may have changed it
  try { process.chdir(originalCwd) } catch { /* already gone? ignore */ }
  await rm(tmpDir, { recursive: true, force: true })
})

describe('generateWorktreeName', () => {
  it('returns adjective-noun format', () => {
    const name = generateWorktreeName()
    expect(name).toMatch(/^[a-z]+-[a-z]+$/)
  })

  it('returns different names on repeated calls (probabilistic)', () => {
    const names = new Set(Array.from({ length: 20 }, () => generateWorktreeName()))
    // With 30 adjectives × 30 nouns = 900 combinations, chance of all same is ~0
    expect(names.size).toBeGreaterThan(1)
  })
})

describe('validatePathUnderWorktrees', () => {
  it('returns true for a path under the worktrees dir', () => {
    const target = join(tmpDir, '.deepseek', 'worktrees', 'swift-fox')
    expect(validatePathUnderWorktrees(target, tmpDir)).toBe(true)
  })

  it('returns false for a path outside the worktrees dir', () => {
    const target = join(tmpDir, 'some-other-dir')
    expect(validatePathUnderWorktrees(target, tmpDir)).toBe(false)
  })

  it('blocks path traversal attempts', () => {
    const target = join(tmpDir, '.deepseek', 'worktrees', '..', '..', 'etc', 'passwd')
    expect(validatePathUnderWorktrees(target, tmpDir)).toBe(false)
  })

  it('blocks absolute path outside project', () => {
    expect(validatePathUnderWorktrees('/tmp/evil', tmpDir)).toBe(false)
  })
})

describe('createWorktree (filesystem copy — non-git dir)', () => {
  it('creates worktree directory', async () => {
    // Create a simple file in tmpDir to copy
    await writeFile(join(tmpDir, 'hello.txt'), 'hello')

    const info = await createWorktree(tmpDir)

    expect(existsSync(info.path)).toBe(true)
    expect(info.name).toMatch(/^[a-z]+-[a-z]+$/)
    expect(info.originalCwd).toBe(tmpDir)
    expect(info.isGitWorktree).toBe(false)
  })

  it('copies project files but excludes node_modules, .git, dist', async () => {
    // Setup project structure
    await writeFile(join(tmpDir, 'index.ts'), 'export {}')
    await mkdir(join(tmpDir, 'node_modules', 'some-pkg'), { recursive: true })
    await writeFile(join(tmpDir, 'node_modules', 'some-pkg', 'index.js'), 'module')
    await mkdir(join(tmpDir, 'dist'), { recursive: true })
    await writeFile(join(tmpDir, 'dist', 'bundle.js'), 'bundle')

    const info = await createWorktree(tmpDir)

    expect(existsSync(join(info.path, 'index.ts'))).toBe(true)
    expect(existsSync(join(info.path, 'node_modules'))).toBe(false)
    expect(existsSync(join(info.path, 'dist'))).toBe(false)
  })

  it('persists state with active worktree', async () => {
    const info = await createWorktree(tmpDir)
    const active = await getActiveWorktree(tmpDir)
    expect(active).not.toBeNull()
    expect(active!.name).toBe(info.name)
  })
})

describe('enterWorktree', () => {
  it('sets active worktree for an existing directory', async () => {
    // Create the worktree dir manually
    const wt = await createWorktree(tmpDir)

    // Exit it first
    await exitWorktree(tmpDir, true)

    // Re-enter
    const info = await enterWorktree(tmpDir, wt.name)
    expect(info.name).toBe(wt.name)
    expect(existsSync(info.path)).toBe(true)

    const active = await getActiveWorktree(tmpDir)
    expect(active!.name).toBe(wt.name)
  })

  it('throws when worktree name does not exist', async () => {
    await expect(enterWorktree(tmpDir, 'nonexistent-name')).rejects.toThrow('not found')
  })
})

describe('exitWorktree', () => {
  it('keep=true preserves the worktree directory', async () => {
    const info = await createWorktree(tmpDir)
    const worktreePath = info.path

    await exitWorktree(tmpDir, true)

    expect(existsSync(worktreePath)).toBe(true)

    const active = await getActiveWorktree(tmpDir)
    expect(active).toBeNull()
  })

  it('keep=false removes the worktree directory', async () => {
    const info = await createWorktree(tmpDir)
    const worktreePath = info.path

    await exitWorktree(tmpDir, false)

    expect(existsSync(worktreePath)).toBe(false)
    const active = await getActiveWorktree(tmpDir)
    expect(active).toBeNull()
  })

  it('returns message when no worktree is active', async () => {
    const result = await exitWorktree(tmpDir, false)
    expect(result).toContain('No active worktree')
  })

  it('adds exited worktree to history', async () => {
    await createWorktree(tmpDir)
    await exitWorktree(tmpDir, true)

    const stateFile = join(tmpDir, '.deepseek', 'worktree-state.json')
    const raw = await readFile(stateFile, 'utf-8')
    const state: WorktreeState = JSON.parse(raw)

    expect(state.history.length).toBeGreaterThan(0)
  })
})

describe('listWorktrees', () => {
  it('returns empty array when no worktrees dir exists', async () => {
    const result = await listWorktrees(tmpDir)
    expect(result).toEqual([])
  })

  it('lists created worktrees', async () => {
    const info = await createWorktree(tmpDir)
    const list = await listWorktrees(tmpDir)
    const found = list.find(w => w.name === info.name)
    expect(found).toBeDefined()
  })

  it('returns multiple worktrees', async () => {
    await createWorktree(tmpDir)
    // Manually create a second worktree dir to test listing
    const worktreesDir = join(tmpDir, '.deepseek', 'worktrees')
    await mkdir(join(worktreesDir, 'manual-wt'), { recursive: true })

    const list = await listWorktrees(tmpDir)
    expect(list.length).toBeGreaterThanOrEqual(2)
  })
})

describe('state persistence round-trip', () => {
  it('saves and loads state correctly', async () => {
    const info = await createWorktree(tmpDir)

    // Read state from disk
    const stateFile = join(tmpDir, '.deepseek', 'worktree-state.json')
    const raw = await readFile(stateFile, 'utf-8')
    const state: WorktreeState = JSON.parse(raw)

    expect(state.active).not.toBeNull()
    expect(state.active!.name).toBe(info.name)
    expect(state.active!.path).toBe(info.path)
    expect(state.active!.originalCwd).toBe(tmpDir)
  })
})
