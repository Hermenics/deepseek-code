import { join, resolve } from 'path'
import { mkdir, readFile, writeFile, readdir, realpath, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { execa } from 'execa'
import { randomBytes, randomUUID } from 'crypto'
import { loadMergedSettings } from '../settings/loader.js'
import { runClaudeHookEvent } from '../hooks/lifecycle.js'

const ADJECTIVES = [
  'swift', 'bold', 'calm', 'dark', 'keen', 'warm', 'wild', 'sure', 'vast', 'pure',
  'crisp', 'fresh', 'brave', 'sharp', 'clear', 'quick', 'neat', 'soft', 'bright', 'light',
  'deep', 'thin', 'free', 'cool', 'fair', 'gold', 'iron', 'jade', 'lean', 'raw',
]
const NOUNS = [
  'fox', 'owl', 'elk', 'wolf', 'bear', 'hawk', 'lynx', 'crow', 'deer', 'hare',
  'eagle', 'otter', 'raven', 'tiger', 'crane', 'bison', 'puma', 'dove', 'seal', 'wren',
  'finch', 'viper', 'moth', 'bass', 'carp', 'lark', 'swan', 'toad', 'mole', 'wasp',
]

const WORKTREES_DIR = '.deepseek/worktrees'
const STATE_FILE = '.deepseek/worktree-state.json'

export interface WorktreeInfo {
  name: string
  path: string
  originalCwd: string
  createdAt: string
  isGitWorktree: boolean
  branch?: string
  sessionId?: string
}

export interface WorktreeState {
  active: WorktreeInfo | null
  history: WorktreeInfo[]
}

export function generateWorktreeName(): string {
  // Derive both indices from a crypto UUID so names are unique per call and no
  // Math.random is used (CodeQL js/insecure-randomness).
  const seed = randomUUID().replace(/-/g, '')
  const adj = ADJECTIVES[parseInt(seed.slice(0, 2), 16) % ADJECTIVES.length]!
  const noun = NOUNS[parseInt(seed.slice(2, 4), 16) % NOUNS.length]!
  return `${adj}-${noun}`
}

export function isGitRepository(dir: string): boolean {
  return existsSync(join(dir, '.git'))
}

async function loadState(projectRoot: string): Promise<WorktreeState> {
  const stateFile = join(projectRoot, STATE_FILE)
  try {
    const raw = await readFile(stateFile, 'utf-8')
    return JSON.parse(raw) as WorktreeState
  } catch {
    return { active: null, history: [] }
  }
}

async function saveState(projectRoot: string, state: WorktreeState): Promise<void> {
  const stateFile = join(projectRoot, STATE_FILE)
  const dir = join(projectRoot, '.deepseek')
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  await writeFile(stateFile, JSON.stringify(state, null, 2))
}

export function validatePathUnderWorktrees(targetPath: string, projectRoot: string): boolean {
  const worktreesRoot = resolve(projectRoot, WORKTREES_DIR)
  const resolved = resolve(targetPath)
  return resolved.startsWith(worktreesRoot + '/') || resolved === worktreesRoot
}

export async function createWorktree(projectRoot: string, sessionId?: string): Promise<WorktreeInfo> {
  const useGit = isGitRepository(projectRoot)
  if (!useGit) throw new Error('Git worktrees are unavailable. Refusing an unsafe copied-workspace fallback.')
  const settings = await loadMergedSettings(projectRoot)

  // Generate unique name with retry
  let name = ''
  let worktreePath = ''
  for (let attempt = 0; attempt < 10; attempt++) {
    name = generateWorktreeName()
    worktreePath = join(projectRoot, WORKTREES_DIR, name)
    if (!existsSync(worktreePath)) break
    if (attempt === 9) throw new Error('Failed to generate unique worktree name after 10 attempts.')
  }

  let branch: string | undefined
  if (useGit) {
    // Use git worktree
    const worktreesDir = join(projectRoot, WORKTREES_DIR)
    const pattern = settings.git?.branchPattern ?? 'deepseek/{slug}-{shortId}'
    branch = pattern
      .replaceAll('{slug}', name)
      .replaceAll('{shortId}', randomBytes(3).toString('hex'))
      .replace(/[^a-zA-Z0-9/_-]/g, '-')
    const hook = await runClaudeHookEvent(settings.hooks, 'WorktreeCreate', sessionId ?? 'worktree', {
      cwd: projectRoot, name, path: worktreePath,
    })
    if (hook.decision === 'block') throw new Error(hook.reason ?? 'Worktree creation blocked by hook')
    try {
      if (!existsSync(worktreesDir)) await mkdir(worktreesDir, { recursive: true })
      await execa('git', ['worktree', 'add', '-b', branch, worktreePath], { cwd: projectRoot, stdio: 'pipe' })
    } catch (e) {
      throw new Error(`git worktree add failed: ${(e as Error).message}`)
    }
  }

  const info: WorktreeInfo = {
    name,
    path: worktreePath,
    originalCwd: projectRoot,
    createdAt: new Date().toISOString(),
    isGitWorktree: useGit,
    branch,
    sessionId,
  }

  const state = await loadState(projectRoot)
  if (state.active) state.history.push(state.active)
  state.active = info
  await saveState(projectRoot, state)

  return info
}

export async function enterWorktree(projectRoot: string, name: string, sessionId?: string): Promise<WorktreeInfo> {
  const worktreePath = join(projectRoot, WORKTREES_DIR, name)

  if (!validatePathUnderWorktrees(worktreePath, projectRoot)) {
    throw new Error(`Invalid worktree name: "${name}" resolves outside worktrees directory`)
  }

  if (!existsSync(worktreePath)) {
    throw new Error(`Worktree "${name}" not found at ${worktreePath}`)
  }

  const info: WorktreeInfo = {
    name,
    path: worktreePath,
    originalCwd: projectRoot,
    createdAt: new Date().toISOString(), // approximate
    isGitWorktree: existsSync(join(worktreePath, '.git')),
    sessionId,
  }

  const state = await loadState(projectRoot)
  if (state.active) state.history.push(state.active)
  state.active = info
  await saveState(projectRoot, state)

  return info
}

export async function exitWorktree(projectRoot: string, keep: boolean): Promise<string> {
  const state = await loadState(projectRoot)
  if (!state.active) return 'No active worktree.'

  const { name, path, isGitWorktree } = state.active

  if (!keep) {
    const settings = await loadMergedSettings(projectRoot)
    const hook = await runClaudeHookEvent(settings.hooks, 'WorktreeRemove', state.active.sessionId ?? 'worktree', {
      cwd: projectRoot, name, path,
    })
    if (hook.decision === 'block') throw new Error(hook.reason ?? 'Worktree removal blocked by hook')
  }

  if (!keep) {
    // Validate path is under worktrees dir
    const realTarget = await realpath(path).catch(() => path)
    if (!validatePathUnderWorktrees(realTarget, projectRoot)) {
      throw new Error(`Refused: path "${path}" is not under ${WORKTREES_DIR}`)
    }

    if (!isGitWorktree) throw new Error(`Legacy copied worktree "${name}" was preserved; remove it manually after inspection.`)
    const status = await execa('git', ['status', '--porcelain=v1'], { cwd: path, reject: false })
    if (status.stdout.trim()) throw new Error(`Worktree "${name}" has uncommitted changes and was preserved.`)
    const removed = await execa('git', ['worktree', 'remove', path], { cwd: projectRoot, reject: false })
    if (removed.exitCode !== 0) throw new Error(removed.stderr || removed.stdout || `Unable to remove worktree "${name}"`)
  }

  state.history.push(state.active)
  state.active = null
  await saveState(projectRoot, state)

  return keep
    ? `Worktree "${name}" kept at ${path}. Use /worktree enter ${name} to return.`
    : `Worktree "${name}" removed.`
}

export async function listWorktrees(projectRoot: string): Promise<WorktreeInfo[]> {
  const worktreesDir = join(projectRoot, WORKTREES_DIR)
  if (!existsSync(worktreesDir)) return []

  const entries = await readdir(worktreesDir, { withFileTypes: true })
  const results: WorktreeInfo[] = []

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const fullPath = join(worktreesDir, entry.name)
      const stats = await stat(fullPath).catch(() => null)
      results.push({
        name: entry.name,
        path: fullPath,
        originalCwd: projectRoot,
        createdAt: stats?.birthtime?.toISOString() ?? 'unknown',
        isGitWorktree: existsSync(join(fullPath, '.git')),
      })
    }
  }

  return results
}

export async function getActiveWorktree(projectRoot: string): Promise<WorktreeInfo | null> {
  const state = await loadState(projectRoot)
  return state.active
}

export function isInsideWorktree(projectRoot: string, cwd = process.cwd()): boolean {
  const worktreesRoot = resolve(projectRoot, WORKTREES_DIR)
  return cwd.startsWith(worktreesRoot)
}
